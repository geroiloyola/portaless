// Tests unitarios reales de verifyWebBotAuthRequest(): construye firmas
// Ed25519 genuinas via WebCrypto (no fixtures fabricadas a mano) y mockea
// unicamente global.fetch (el directorio de claves remoto del operador),
// que es el unico limite de red real de esta funcion.
//
// Cubre especificamente los dos gaps que v0.0.9 cierra -- ver
// ROADMAP.md "Cache del directorio de claves Web Bot Auth" y
// "verificacion de unicidad de nonce":
// 1. El directorio se cachea entre requests (no hay un fetch por request).
// 2. Un Signature-Input/Signature reenviado tal cual (replay) es
//    rechazado la segunda vez, aunque la firma siga siendo
//    criptograficamente valida.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  verifyWebBotAuthRequest,
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
} from "../../packages/trust-layer/src/webbotauth/verify";
import { buildSignatureBase, parseSignatureInput } from "../../packages/trust-layer/src/webbotauth/rfc9421";

const OPERATOR_ORIGIN = "https://agent-operator.example.com";
const KEY_ID = "test-key-1";

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

interface SignedRequestOptions {
  privateKey: CryptoKey;
  keyId: string;
  nonce?: string;
  created?: number;
  expires?: number;
  method?: string;
  url?: string;
}

async function buildSignedRequest(opts: SignedRequestOptions): Promise<Request> {
  const method = opts.method ?? "GET";
  const url = opts.url ?? "https://mysite.example/paginas/foo";
  const created = opts.created ?? Math.floor(Date.now() / 1000);

  const paramsLine =
    `("@method" "@authority" "@path")` +
    `;keyid="${opts.keyId}";alg="ed25519"` +
    `;created=${created}` +
    (opts.expires ? `;expires=${opts.expires}` : "") +
    (opts.nonce ? `;nonce="${opts.nonce}"` : "");

  // La request "a firmar" se construye sin Signature todavia -- solo para
  // que buildSignatureBase() (la MISMA funcion que usa verify.ts en
  // produccion) calcule la base exacta a partir de Signature-Input, en vez
  // de duplicar esa logica a mano en el test y arriesgar una base
  // ligeramente distinta a la real.
  const unsigned = new Request(url, {
    method,
    headers: { "Signature-Agent": OPERATOR_ORIGIN, "Signature-Input": `sig1=${paramsLine}` },
  });
  const parsed = parseSignatureInput(`sig1=${paramsLine}`);
  if (!parsed) throw new Error("test helper: Signature-Input construido no parseo");
  const signatureBase = buildSignatureBase(unsigned, parsed);

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("Ed25519", opts.privateKey, new TextEncoder().encode(signatureBase))
  );

  const headers = new Headers({
    "Signature-Agent": OPERATOR_ORIGIN,
    "Signature-Input": `sig1=${paramsLine}`,
    Signature: `sig1=:${bytesToBase64(signatureBytes)}:`,
  });

  return new Request(url, { method, headers });
}

describe("verifyWebBotAuthRequest", () => {
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

  it("verifica una request correctamente firmada con Ed25519 real", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified, `deberia verificar. razon: ${result.reason}`).toBe(true);
    expect(result.keyRecord?.keyId).toBe(KEY_ID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cachea el directorio de claves: la segunda request al mismo operador no vuelve a fetchear", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const first = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-a" });
    const firstResult = await verifyWebBotAuthRequest(first);
    expect(firstResult.verified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-b" });
    const secondResult = await verifyWebBotAuthRequest(second);
    expect(secondResult.verified, `deberia verificar. razon: ${secondResult.reason}`).toBe(true);
    // Sigue en 1: el directorio se sirvio desde cache, no se volvio a llamar fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rechaza un replay exacto de la misma request firmada (nonce reusado)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);
    mockDirectoryOnce(publicKeyX); // por si el cache no aplicara, no deberia hacer fallar el test por falta de mock

    const nonce = "replay-nonce-123";
    const created = Math.floor(Date.now() / 1000);
    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce, created });

    // Clonamos la request original ANTES de consumirla, para simular un
    // atacante interceptando y reenviando el mismo mensaje firmado tal cual.
    const replay = request.clone();

    const firstResult = await verifyWebBotAuthRequest(request);
    expect(firstResult.verified, `primer uso deberia verificar. razon: ${firstResult.reason}`).toBe(true);

    const replayResult = await verifyWebBotAuthRequest(replay);
    expect(replayResult.verified).toBe(false);
    expect(replayResult.reason).toBe("nonce_replayed");
  });

  it("dos requests distintas con nonces distintos del mismo operador ambas verifican", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const reqA = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-unique-a" });
    const reqB = await buildSignedRequest({ privateKey, keyId: KEY_ID, nonce: "nonce-unique-b" });

    const resultA = await verifyWebBotAuthRequest(reqA);
    const resultB = await verifyWebBotAuthRequest(reqB);

    expect(resultA.verified).toBe(true);
    expect(resultB.verified).toBe(true);
  });

  it("rechaza una firma criptograficamente invalida (clave equivocada)", async () => {
    const { publicKeyX } = await generateKeyPair();
    const attacker = await generateKeyPair(); // el atacante firma con SU propia clave...
    mockDirectoryOnce(publicKeyX); // ...pero el directorio solo publica la clave legitima.

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

  it("rechaza una firma expirada (created fuera de la ventana MAX_SIGNATURE_AGE_SECONDS)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectoryOnce(publicKeyX);

    const staleCreated = Math.floor(Date.now() / 1000) - 3600; // 1 hora atras
    const request = await buildSignedRequest({ privateKey, keyId: KEY_ID, created: staleCreated });
    const result = await verifyWebBotAuthRequest(request);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_too_old");
  });
});
