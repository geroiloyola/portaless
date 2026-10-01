// Tests de verifyWebBotAuthRequest() de site-trust usando la clave de test
// oficial de RFC 9421 Appendix B.1.4.
//
// FIX v8: el keyid que termina en Signature-Input SIEMPRE sale de
// `signer.keyid` (thumbprint RFC 7638 calculado por Ed25519Signer.fromJWK),
// nunca del `kid` que trae el JWK de prueba. `SignatureParams` de
// signatureHeaders() no tiene campo `keyid`: se ignora en silencio. Por eso
// el JWKS mockeado publica el JWK con kid = signer.keyid.
//
// PR H: Signature-Agent va con comillas (sf-string de draft-03). La forma
// sin comillas ahora se rechaza en ambos verificadores (webbotauth/headers.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { verifyWebBotAuthRequest } from "../web-bot-auth";

const RFC_9421_ED25519_TEST_KEY = {
  kty: "OKP",
  crv: "Ed25519",
  kid: "test-key-ed25519",
  x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
  d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
};

const SIGNATURE_AGENT_HEADER = '"https://agent.example.test"';

async function buildSignedRequest(): Promise<{ request: Request; realKeyId: string }> {
  const request = new Request("https://portaless.example/trust/site.example/agent-verification", {
    method: "POST",
    headers: { "Signature-Agent": SIGNATURE_AGENT_HEADER },
  });

  const created = new Date();
  const expires = new Date(created.getTime() + 300_000);

  const signer = await signerFromJWK(RFC_9421_ED25519_TEST_KEY);

  const headers = await signatureHeaders(request.clone(), signer, {
    created,
    expires,
  });

  const finalRequest = request.clone();
  for (const [k, v] of Object.entries(headers)) {
    finalRequest.headers.set(k, v as string);
  }

  return { request: finalRequest, realKeyId: signer.keyid };
}

function publicJwkWithRealKeyId(realKeyId: string) {
  return {
    kty: RFC_9421_ED25519_TEST_KEY.kty,
    crv: RFC_9421_ED25519_TEST_KEY.crv,
    kid: realKeyId,
    x: RFC_9421_ED25519_TEST_KEY.x,
  };
}

describe("verifyWebBotAuthRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifica correctamente un request firmado con una clave que existe en el JWKS", async () => {
    const { request: signedRequest, realKeyId } = await buildSignedRequest();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwkWithRealKeyId(realKeyId)] }), { status: 200 })
    );

    const result = await verifyWebBotAuthRequest(signedRequest);

    if (!result.verified) {
      throw new Error(
        `La verificacion fallo. Razon: ${result.reason}. Signature-Input: ${signedRequest.headers.get("Signature-Input")}`
      );
    }

    expect(result.verified).toBe(true);
    expect(result.agentKeyId).toBe(realKeyId);
  });

  it("devuelve verified:false si faltan los headers de firma -- nunca lanza", async () => {
    const unsignedRequest = new Request("https://portaless.example/trust/site.example/agent-verification", {
      method: "POST",
    });

    const result = await verifyWebBotAuthRequest(unsignedRequest);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("missing_signature_headers");
  });

  it("devuelve verified:false si el keyid no esta en el JWKS publicado", async () => {
    const { request: signedRequest } = await buildSignedRequest();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [] }), { status: 200 })
    );

    const result = await verifyWebBotAuthRequest(signedRequest);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("keyid_not_in_jwks");
  });

  it("usa el cache KV si esta disponible, evitando un fetch repetido", async () => {
    const { request: firstRequest, realKeyId } = await buildSignedRequest();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwkWithRealKeyId(realKeyId)] }), { status: 200 })
    );

    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const { request: secondRequest } = await buildSignedRequest();

    await verifyWebBotAuthRequest(firstRequest, kv);
    await verifyWebBotAuthRequest(secondRequest, kv);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
