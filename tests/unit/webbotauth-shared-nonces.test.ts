// Tests de anti-replay COMPARTIDO en verifyWebBotAuthRequest() (v0.0.9.31):
// el escenario que el Map en memoria por proceso no cubria. Con
// options.env (DB / PORTALESS_SQLITE_PATH) el nonce se registra en
// webbotauth_nonces (D1/SQLite), asi que DOS workers sobre la misma base
// comparten la ventana de 300 s. El "segundo worker" se simula limpiando
// el cache del factory (__resetNonceStoreFactoryForTests): el factory
// vuelve a construir una instancia NUEVA sobre el MISMO archivo, igual
// que un proceso aparte. Firmas Ed25519 reales; solo se mockea fetch
// (el directorio de claves del operador). Ver
// packages/trust-layer/src/webbotauth/nonce-store.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyWebBotAuthRequest,
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
} from "../../packages/trust-layer/src/webbotauth/verify";
import { __resetNonceStoreFactoryForTests } from "../../packages/trust-layer/src/webbotauth/nonce-store";
import { buildSignatureBase, parseSignatureInput } from "../../packages/trust-layer/src/webbotauth/rfc9421";

const OPERATOR_ORIGIN = "https://agent-operator.example.com";
const KEY_ID = "test-key-1";
const DEFAULT_COMPONENTS = '"@method" "@authority" "@path" "signature-agent"';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function generateKeyPair() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return { privateKey: keyPair.privateKey, publicKeyX: bytesToBase64Url(rawPublic) };
}

async function buildSignedRequest(
  privateKey: CryptoKey,
  opts: { nonce: string; created?: number; expires?: number; url?: string }
): Promise<Request> {
  const url = opts.url ?? "https://mysite.example/pages/foo";
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const expires = opts.expires ?? created + 300;
  const agentHeader = `"${OPERATOR_ORIGIN}"`;

  const paramsLine =
    `(${DEFAULT_COMPONENTS})` +
    `;created=${created};expires=${expires}` +
    `;keyid="${KEY_ID}";alg="ed25519"` +
    `;nonce="${opts.nonce}"` +
    `;tag="web-bot-auth"`;

  const unsigned = new Request(url, {
    method: "GET",
    headers: { "Signature-Agent": agentHeader, "Signature-Input": `sig1=${paramsLine}` },
  });
  const parsed = parseSignatureInput(`sig1=${paramsLine}`);
  if (!parsed) throw new Error("test helper: Signature-Input construido no parseo");
  const signatureBase = buildSignatureBase(unsigned, parsed);
  if (!signatureBase) throw new Error("test helper: falta un header firmado");

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase))
  );

  return new Request(url, {
    method: "GET",
    headers: {
      "Signature-Agent": agentHeader,
      "Signature-Input": `sig1=${paramsLine}`,
      Signature: `sig1=:${bytesToBase64(signatureBytes)}:`,
    },
  });
}

describe("verifyWebBotAuthRequest -- nonces compartidos entre instancias (options.env)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let dir: string;
  let dbPath: string;
  let env: { PORTALESS_SQLITE_PATH: string };

  beforeEach(() => {
    __resetDirectoryCacheForTests();
    __resetNonceStoreForTests();
    __resetNonceStoreFactoryForTests();
    dir = mkdtempSync(join(tmpdir(), "pless-shared-nonces-"));
    dbPath = join(dir, "portaless-test.db");
    env = { PORTALESS_SQLITE_PATH: dbPath };
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    __resetNonceStoreFactoryForTests();
    __resetNonceStoreForTests();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  function mockDirectoryOnce(publicKeyX: string, keyId = KEY_ID) {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [{ kid: keyId, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }] }),
    });
  }

  it("con env: el mismo nonce en dos requests es replay en el MISMO proceso (SQLite)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX);

    const first = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-same" }), { env });
    expect(first.verified).toBe(true);

    const replay = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-same" }), { env });
    expect(replay.verified).toBe(false);
    expect(replay.reason).toBe("nonce_replayed");
  });

  it("DOS workers sobre la misma base detectan el replay cross-instance", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX);

    // Worker A (proceso 1): consume el nonce.
    const workerA = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-cross" }), { env });
    expect(workerA.verified).toBe(true);

    // Worker B: simula un proceso aparte limpiando el cache del factory --
    // abre una instancia NUEVA sobre el MISMO archivo SQLite.
    __resetNonceStoreFactoryForTests();

    const workerB = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-cross" }), { env });
    expect(workerB.verified).toBe(false);
    expect(workerB.reason).toBe("nonce_replayed");
  });

  it("con env: nonces distintos pasan aunque vengan de workers distintos", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX);

    const a = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-de-a" }), { env });
    expect(a.verified).toBe(true);

    __resetNonceStoreFactoryForTests(); // "otro proceso"

    const b = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-de-b" }), { env });
    expect(b.verified).toBe(true);
  });

  it("sin options.env se conserva el anti-replay en memoria del proceso (backward compatible)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX);

    const first = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-mem" }));
    expect(first.verified).toBe(true);

    const replay = await verifyWebBotAuthRequest(await buildSignedRequest(privateKey, { nonce: "n-mem" }));
    expect(replay.verified).toBe(false);
    expect(replay.reason).toBe("nonce_replayed");
  });

  it("las tablas del schema maestro incluyen webbotauth_nonces (generado por generate-schema.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const schema = readFileSync(joinPath(process.cwd(), "schema.sql"), "utf-8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS webbotauth_nonces");
    expect(schema).toContain("idx_webbotauth_nonces_expires_at");
  });
});
