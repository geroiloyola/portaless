// Tests reales del verificador ML-DSA (FIPS 204) de
// packages/trust-layer/src/site-trust/web-bot-auth.ts. Sin mocks de
// criptografia: genera pares de claves ML-DSA reales con
// @noble/post-quantum, firma bytes reales y verifica. Cubre el
// verificador en aislamiento (ambas formas: funcion que lanza y objeto con
// verify() booleano). La ruta completa verifyWebBotAuthRequest() con un
// request firmado con ML-DSA de punta a punta NO esta cubierta todavia:
// requiere armar el signature base RFC 9421 con un firmante ML-DSA.
//
// Orden de argumentos en @noble/post-quantum 0.5.x: sign(mensaje,
// claveSecreta) y verify(firma, mensaje, clavePublica). El primer CI del
// PR #54 fallo porque este test usaba el orden inverso.
import { describe, it, expect } from "vitest";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import {
  createMlDsaVerifier,
  isMlDsaJwk,
  jwkKeyAlgorithm,
} from "../../packages/trust-layer/src/site-trust/web-bot-auth";

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const IMPLS = { "ML-DSA-44": ml_dsa44, "ML-DSA-65": ml_dsa65, "ML-DSA-87": ml_dsa87 } as const;

function makeKey(alg: keyof typeof IMPLS) {
  const keys = IMPLS[alg].keygen();
  const jwk = { kty: "AKP", alg, kid: `test-${alg}`, pub: bytesToBase64Url(keys.publicKey) };
  return { keys, jwk, impl: IMPLS[alg] };
}

const MESSAGE = '"@authority": example.com\n"@signature-params": ("@authority");keyid="test"';

describe("ML-DSA verifier (FIPS 204)", () => {
  for (const alg of Object.keys(IMPLS) as (keyof typeof IMPLS)[]) {
    it(`acepta una firma valida ${alg} (forma objeto y forma funcion)`, async () => {
      const { keys, jwk, impl } = makeKey(alg);
      const data = new TextEncoder().encode(MESSAGE);
      const sig = impl.sign(data, keys.secretKey);
      const v = createMlDsaVerifier(jwk);
      expect(await v.verify(data, sig)).toBe(true);
      await expect(v(MESSAGE, sig)).resolves.toBeUndefined();
      expect(v.algorithm).toBe(alg.toLowerCase());
      expect(v.keyid).toBe(`test-${alg}`);
    });
  }

  it("rechaza una firma de otra clave", async () => {
    const a = makeKey("ML-DSA-65");
    const b = makeKey("ML-DSA-65");
    const data = new TextEncoder().encode(MESSAGE);
    const sig = b.impl.sign(data, b.keys.secretKey);
    const v = createMlDsaVerifier(a.jwk);
    expect(await v.verify(data, sig)).toBe(false);
    await expect(v(data, sig)).rejects.toThrow("invalid_ml_dsa_signature");
  });

  it("rechaza un mensaje alterado", async () => {
    const { keys, jwk, impl } = makeKey("ML-DSA-65");
    const sig = impl.sign(new TextEncoder().encode(MESSAGE), keys.secretKey);
    const v = createMlDsaVerifier(jwk);
    expect(await v.verify(MESSAGE + "x", sig)).toBe(false);
  });

  it("rechaza una firma corrupta sin lanzar desde verify()", async () => {
    const { jwk } = makeKey("ML-DSA-44");
    const v = createMlDsaVerifier(jwk);
    expect(await v.verify(MESSAGE, new Uint8Array(10))).toBe(false);
  });

  it("no construye verificador para alg desconocido ni sin clave publica", () => {
    expect(() => createMlDsaVerifier({ kty: "AKP", alg: "ML-DSA-99", pub: "AA" })).toThrow("unsupported_pq_algorithm");
    expect(() => createMlDsaVerifier({ kty: "AKP", alg: "ML-DSA-65" })).toThrow("missing_ml_dsa_public_key");
  });

  it("clasifica JWKs y mapea a authorized_agents.key_algorithm", () => {
    expect(isMlDsaJwk({ kty: "AKP", alg: "ML-DSA-65" })).toBe(true);
    expect(isMlDsaJwk({ kty: "OKP", alg: "EdDSA" })).toBe(false);
    expect(jwkKeyAlgorithm({ kty: "AKP", alg: "ML-DSA-87" })).toBe("ml-dsa-87");
    expect(jwkKeyAlgorithm({ kty: "OKP", crv: "Ed25519", x: "AA" })).toBe("ed25519");
    expect(jwkKeyAlgorithm({ kty: "RSA" })).toBe("unknown");
  });
});
