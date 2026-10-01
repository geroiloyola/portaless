// Tests de webbotauth/verify.ts, el verificador del middleware (todas las
// plataformas). Firmas Ed25519 reales via WebCrypto; solo se mockea fetch
// (el directorio de claves del operador).
//
// PR H: el helper firma como un agente real de draft-03: Signature-Agent con
// comillas, tag="web-bot-auth", signature-agent entre los componentes y
// created/expires. Antes los tests firmaban con buildSignatureBase() de
// rfc9421.ts, la misma funcion que verifica: un error en ella (descartaba tag
// y nonce de @signature-params) quedaba oculto. Por eso se agrega un test de
// interoperabilidad que firma con la libreria web-bot-auth, otra
// implementacion independiente.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import {
  verifyWebBotAuthRequest,
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
} from "../../packages/trust-layer/src/webbotauth/verify";
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
  return { keyPair, privateKey: keyPair.privateKey, publicKeyX: bytesToBase64Url(rawPublic) };
}

interface SignedRequestOptions {
  privateKey: CryptoKey;
  keyId: string;
  nonce?: string;
  created?: number;
  expires?: number;
  method?: string;
  url?: string;
  signatureAgentHeader?: string;
  components?: string;
}

async function buildSignedRequest(opts: SignedRequestOptions): Promise<Request> {
  const method = opts.method ?? "GET";
  const url = opts.url ?? "https://mysite.example/paginas/foo";
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const expires = opts.expires ?? created + 300;
  const agentHeader = opts.signatureAgentHeader ?? `"${OPERATOR_ORIGIN}"`;

  const paramsLine =
    `(${opts.components ?? DEFAULT_COMPONENTS})` +
    `;created=${created};expires=${expires}` +
    `;keyid="${opts.keyId}";alg="ed25519"` +
    (opts.nonce ? `;nonce="${opts.nonce}"` : "") +
    `;tag="web-bot-auth"`;

  const unsigned = new Request(url, {
    method,
    headers: { "Signature-Agent": agentHeader, "Signature-Input": `sig1=${paramsLine}` },
  });
  const parsed = parseSignatureInput(`sig1=${paramsLine}`);
  if (!parsed) throw new Error("test helper: Signature-Input construido no parseo");
  const signatureBase = buildSignatureBase(unsigned, parsed);
  if (!signatureBase) throw new Error("test helper: falta un header firmado");

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("Ed25519", opts.privateKey, new TextEncoder().encode(signatureBase))
  );

  const headers = new Headers({
    "Signature-Agent": agentHeader,
    "Signature-Input": `sig1=${paramsLine}`,
    Signature: `sig1=:${bytesToBase64(signatureBytes)}:`,
  });

  return new Request(url, { method, headers });
}

describe("verifyWebBotAuthRequest (middleware)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetDirectoryCacheForTests();
    __resetNonceStoreForTests();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockDirectoryOnce(publicKeyX: string, keyId = KEY_ID) {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ keys: [{ kid: keyId, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }] }),
    });
  }

  it("verifica una request firmada segun draft-03 y devuelve agentKeyId para el ledger", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "n-1" });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified, `deberia verificar. razon: ${result.reason}`).toBe(true);
    // Regresion del #65: el middleware lee agentKeyId; nunca debe quedar "unknown".
    expect(result.agentKeyId).toBe(KEY_ID);
    expect(result.keyRecord?.keyId).toBe(KEY_ID);
    expect(result.keyRecord?.operator).toBe(OPERATOR_ORIGIN);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("interoperabilidad: verifica una firma hecha por la libreria web-bot-auth", async () => {
    // Si falla con signature_agent_not_signed, la libreria no cubre
    // signature-agent por defecto: hay que revisarlo antes de mergear.
    const { keyPair, publicKeyX } = await generateKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const signer = await signerFromJWK(jwk as never);
    mockDirectoryOnce(publicKeyX, signer.keyid);

    const request = new Request("https://mysite.example/paginas/foo", {
      headers: { "Signature-Agent": `"${OPERATOR_ORIGIN}"` },
    });
    const created = new Date();
    const headers = await signatureHeaders(request.clone(), signer, {
      created,
      expires: new Date(created.getTime() + 300_000),
    });
    const signed = request.clone();
    for (const [k, v] of Object.entries(headers)) signed.headers.set(k, v as string);

    const result = await verifyWebBotAuthRequest(signed);
    expect(result.verified, `deberia verificar. razon: ${result.reason}. Signature-Input: ${signed.headers.get("Signature-Input")}`).toBe(true);
  });

  it("rechaza Signature-Agent sin comillas aunque la firma sea valida", async () => {
    const { privateKey } = await generateKeyPair();
    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, signatureAgentHeader: OPERATOR_ORIGIN });
    const result = await verifyWebBotAuthRequest(request);
    expect(result).toMatchObject({ verified: false, reason: "invalid_signature_agent" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza una firma que no cubre signature-agent", async () => {
    const { privateKey } = await generateKeyPair();
    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, components: '"@method" "@authority" "@path"' });
    const result = await verifyWebBotAuthRequest(request);
    expect(result).toMatchObject({ verified: false, reason: "signature_agent_not_signed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza si se cambia Signature-Agent despues de firmar", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    const original = await buildSignedRequest({ privateKey, keyId: KEY_ID });
    const headers = new Headers(original.headers);
    headers.set("Signature-Agent", `"${OPERATOR_ORIGIN}/otro"`);
    const result = await verifyWebBotAuthRequest(new Request(original.url, { headers }));
    expect(result).toMatchObject({ verified: false, reason: "signature_verification_failed" });
  });

  it("cachea el directorio de claves: la segunda request al mismo operador no vuelve a fetchear", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const first = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-a" });
    expect((await verifyWebBotAuthRequest(first)).verified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-b" });
    const secondResult = await verifyWebBotAuthRequest(second);
    expect(secondResult.verified, `deberia verificar. razon: ${secondResult.reason}`).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rechaza un replay exacto de la misma request firmada (nonce reusado)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX);

    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "replay-nonce-123" });
    const replay = request.clone();

    const firstResult = await verifyWebBotAuthRequest(request);
    expect(firstResult.verified, `primer uso deberia verificar. razon: ${firstResult.reason}`).toBe(true);

    const replayResult = await verifyWebBotAuthRequest(replay);
    expect(replayResult.verified).toBe(false);
    expect(replayResult.reason).toBe("nonce_replayed");
  });

  it("dos requests con nonces distintos del mismo operador ambas verifican", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const reqA = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-unique-a" });
    const reqB = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-unique-b" });

    expect((await verifyWebBotAuthRequest(reqA)).verified).toBe(true);
    expect((await verifyWebBotAuthRequest(reqB)).verified).toBe(true);
  });

  it("rechaza una firma criptograficamente invalida (clave equivocada)", async () => {
    const { publicKeyX } = await generateKeyPair();
    const attacker = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const request = await buildSignedRequest({ privateKey: attacker.privateKey, keyId: KEY_ID });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_verification_failed");
  });

  it("rechaza si el keyid no esta en el directorio del operador", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX, "otra-key-distinta");

    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("keyid_not_in_directory");
  });

  it("rechaza una firma vieja (created fuera de la ventana MAX_SIGNATURE_AGE_SECONDS)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const staleCreated = Math.floor(Date.now() / 1000) - 3600;
    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, created: staleCreated });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_too_old");
  });
});
