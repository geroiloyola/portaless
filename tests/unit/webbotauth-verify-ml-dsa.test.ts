// ML-DSA (FIPS 204) en el verificador del MIDDLEWARE
// (webbotauth/verify.ts) -- v0.0.9.31. Firmas ML-DSA-44/65/87 REALES con
// @noble/post-quantum sobre el signature base RFC 9421, directorio del
// operador con claves AKP, y el mismo flujo que Ed25519 (created/expires,
// nonce anti-replay, cache del directorio). Sin mocks de criptografia:
// solo se mockea fetch del directorio, igual que webbotauth-verify.test.ts.
//
// Orden de argumentos @noble/post-quantum 0.5.x: sign(mensaje, sk),
// verify(firma, mensaje, pk) -- ver nota en ml-dsa.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import {
  verifyWebBotAuthRequest,
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
} from "../../packages/trust-layer/src/webbotauth/verify";
import { buildSignatureBase, parseSignatureInput } from "../../packages/trust-layer/src/webbotauth/rfc9421";

const OPERATOR_ORIGIN = "https://agent-operator.example.com";
const KEY_ID = "pq-key-1";
const DEFAULT_COMPONENTS = '"@method" "@authority" "@path" "signature-agent"';

const IMPLS = { "ML-DSA-44": ml_dsa44, "ML-DSA-65": ml_dsa65, "ML-DSA-87": ml_dsa87 } as const;
type MlDsaAlgName = keyof typeof IMPLS;

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

function makeMlDsaKey(alg: MlDsaAlgName) {
  const keys = IMPLS[alg].keygen();
  const pub = bytesToBase64Url(keys.publicKey);
  return { keys, pub, alg };
}

interface SignedRequestOptions {
  keys: { secretKey: Uint8Array };
  impl: { sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array };
  keyId?: string;
  /** Parametro alg en Signature-Input; undefined = omitirlo (draft-03 lo deja opcional). */
  algParam?: string;
  nonce?: string;
  created?: number;
  expires?: number;
}

async function buildSignedRequest(opts: SignedRequestOptions): Promise<Request> {
  const url = "https://mysite.example/pages/foo";
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const expires = opts.expires ?? created + 300;
  const agentHeader = `"${OPERATOR_ORIGIN}"`;

  const paramsLine =
    `(${DEFAULT_COMPONENTS})` +
    `;created=${created};expires=${expires}` +
    `;keyid="${opts.keyId ?? KEY_ID}"` +
    (opts.algParam ? `;alg="${opts.algParam}"` : "") +
    (opts.nonce ? `;nonce="${opts.nonce}"` : "") +
    `;tag="web-bot-auth"`;

  const unsigned = new Request(url, {
    headers: { "Signature-Agent": agentHeader, "Signature-Input": `sig1=${paramsLine}` },
  });
  const parsed = parseSignatureInput(`sig1=${paramsLine}`);
  if (!parsed) throw new Error("test helper: Signature-Input construido no parseo");
  const signatureBase = buildSignatureBase(unsigned, parsed);
  if (!signatureBase) throw new Error("test helper: falta un header firmado");

  const signatureBytes = opts.impl.sign(new TextEncoder().encode(signatureBase), opts.keys.secretKey);

  const headers = new Headers({
    "Signature-Agent": agentHeader,
    "Signature-Input": `sig1=${paramsLine}`,
    Signature: `sig1=:${bytesToBase64(signatureBytes)}:`,
  });

  return new Request(url, { headers });
}

describe("verifyWebBotAuthRequest (middleware) -- ML-DSA", () => {
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

  function mockDirectoryOnce(pub: string, keyId = KEY_ID, alg = "ML-DSA-65") {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [{ kid: keyId, kty: "AKP", alg, pub }] }), {
        status: 200,
        headers: { "content-type": "application/http-message-signatures-directory+json" },
      })
    );
  }

  for (const alg of Object.keys(IMPLS) as MlDsaAlgName[]) {
    it(`verifica una firma ${alg} real y devuelve keyAlgorithm en minúsculas`, async () => {
      const { keys, pub } = makeMlDsaKey(alg);
      mockDirectoryOnce(pub, KEY_ID, alg);

      const request = await buildSignedRequest({ keys, impl: IMPLS[alg], algParam: alg });
      const result = await verifyWebBotAuthRequest(request);

      expect(result.verified, `deberia verificar. razon: ${result.reason}`).toBe(true);
      expect(result.agentKeyId).toBe(KEY_ID);
      expect(result.keyAlgorithm).toBe(alg.toLowerCase());
      expect(result.keyRecord?.publicKeyJwk?.pub).toBe(pub);
      expect(result.keyRecord?.publicKeyJwk?.alg).toBe(alg);
    });
  }

  it("acepta sin parametro alg (draft-03 lo deja opcional; manda la clave del directorio)", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys, impl: ml_dsa65 });
    const result = await verifyWebBotAuthRequest(request);
    expect(result.verified, `deberia verificar. razon: ${result.reason}`).toBe(true);
    expect(result.keyAlgorithm).toBe("ml-dsa-65");
  });

  it("normaliza el alg del header sin importar mayúsculas", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys, impl: ml_dsa65, algParam: "Ml-Dsa-65" });
    const result = await verifyWebBotAuthRequest(request);
    expect(result.verified, `deberia verificar. razon: ${result.reason}`).toBe(true);
  });

  it("rechaza alg=ed25519 declarado sobre una clave ML-DSA del directorio (algorithm_key_mismatch)", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    // La firma es criptograficamente valida (se firma con la clave real),
    // pero el alg declarado miente: tiene que fallar ANTES de la crypto.
    const request = await buildSignedRequest({ keys, impl: ml_dsa65, algParam: "ed25519" });
    const result = await verifyWebBotAuthRequest(request);
    expect(result).toMatchObject({ verified: false, reason: "algorithm_key_mismatch" });
  });

  it("rechaza alg=ml-dsa-65 declarado sobre una clave Ed25519 del directorio (algorithm_key_mismatch)", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: bytesToBase64Url(rawPublic), alg: "ed25519" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/http-message-signatures-directory+json" },
        }
      )
    );

    const url = "https://mysite.example/pages/foo";
    const created = Math.floor(Date.now() / 1000);
    const paramsLine =
      `(${DEFAULT_COMPONENTS});created=${created};expires=${created + 300}` +
      `;keyid="${KEY_ID}";alg="ml-dsa-65";tag="web-bot-auth"`;
    const unsigned = new Request(url, {
      headers: { "Signature-Agent": `"${OPERATOR_ORIGIN}"`, "Signature-Input": `sig1=${paramsLine}` },
    });
    const parsed = parseSignatureInput(`sig1=${paramsLine}`)!;
    const base = buildSignatureBase(unsigned, parsed)!;
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(base)));
    const signed = new Request(url, {
      headers: {
        "Signature-Agent": `"${OPERATOR_ORIGIN}"`,
        "Signature-Input": `sig1=${paramsLine}`,
        Signature: `sig1=:${bytesToBase64(sig)}:`,
      },
    });

    const result = await verifyWebBotAuthRequest(signed);
    expect(result).toMatchObject({ verified: false, reason: "algorithm_key_mismatch" });
  });

  it("rechaza un alg no soportado aunque la clave sea válida", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys, impl: ml_dsa65, algParam: "ecdsa-p256" });
    const result = await verifyWebBotAuthRequest(request);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/^unsupported_algorithm:/);
  });

  it("rechaza una firma ML-DSA alterada", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys, impl: ml_dsa65 });
    const originalSig = request.headers.get("Signature")!;
    // Corrompe un byte de la firma base64.
    const flipped = originalSig.replace(/:(.+):/, (_m, b64: string) => {
      const chars = [...b64];
      chars[0] = chars[0] === "A" ? "B" : "A";
      return `:${chars.join("")}:`;
    });
    const tamperedHeaders = new Headers(request.headers);
    tamperedHeaders.set("Signature", flipped);
    const tampered = new Request(request.url, { headers: tamperedHeaders });

    const result = await verifyWebBotAuthRequest(tampered);
    expect(result).toMatchObject({ verified: false, reason: "signature_verification_failed" });
  });

  it("rechaza una firma hecha con otra clave ML-DSA", async () => {
    const { pub } = makeMlDsaKey("ML-DSA-65");
    const attacker = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys: attacker.keys, impl: ml_dsa65 });
    const result = await verifyWebBotAuthRequest(request);
    expect(result).toMatchObject({ verified: false, reason: "signature_verification_failed" });
  });

  it("el anti-replay por nonce también aplica en el camino ML-DSA", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-65");
    mockDirectoryOnce(pub);
    mockDirectoryOnce(pub);

    const request = await buildSignedRequest({ keys, impl: ml_dsa65, nonce: "pq-replay-1" });
    const replay = request.clone();

    const first = await verifyWebBotAuthRequest(request);
    expect(first.verified, `primer uso deberia verificar. razon: ${first.reason}`).toBe(true);

    const second = await verifyWebBotAuthRequest(replay);
    expect(second).toMatchObject({ verified: false, reason: "nonce_replayed" });
  });

  it("cachea el directorio también para claves ML-DSA", async () => {
    const { keys, pub } = makeMlDsaKey("ML-DSA-44");
    mockDirectoryOnce(pub, KEY_ID, "ML-DSA-44");

    const a = await buildSignedRequest({ keys, impl: ml_dsa44, nonce: "cache-a" });
    const b = await buildSignedRequest({ keys, impl: ml_dsa44, nonce: "cache-b" });

    expect((await verifyWebBotAuthRequest(a)).verified).toBe(true);
    expect((await verifyWebBotAuthRequest(b)).verified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rechaza una clave AKP sin pub (unsupported_key_type_in_directory)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [{ kid: KEY_ID, kty: "AKP", alg: "ML-DSA-65" }] }), {
        status: 200,
        headers: { "content-type": "application/http-message-signatures-directory+json" },
      })
    );

    const { keys } = makeMlDsaKey("ML-DSA-65");
    const request = await buildSignedRequest({ keys, impl: ml_dsa65 });
    const result = await verifyWebBotAuthRequest(request);
    expect(result).toMatchObject({ verified: false, reason: "unsupported_key_type_in_directory" });
  });
});
