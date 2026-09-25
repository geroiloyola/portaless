// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX (esta sesion, hallazgo de CI tras agregar
// npm test al workflow): signatureHeaders() de la version instalada de
// web-bot-auth requiere explicitamente un campo `created` (Date) --
// getSigningOptions() llamaba a .getTime() sobre un valor undefined sin
// el. Se agrega created: new Date() de forma explicita.

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

const PUBLIC_ONLY_JWK = {
  kty: RFC_9421_ED25519_TEST_KEY.kty,
  crv: RFC_9421_ED25519_TEST_KEY.crv,
  kid: RFC_9421_ED25519_TEST_KEY.kid,
  x: RFC_9421_ED25519_TEST_KEY.x,
};

const SIGNATURE_AGENT_URL = "https://agent.example.test";

async function buildSignedRequest(): Promise<Request> {
  const request = new Request("https://portaless.example/trust/site.example/agent-verification", {
    method: "POST",
    headers: { "Signature-Agent": SIGNATURE_AGENT_URL },
  });

  const headers = await signatureHeaders(request, await signerFromJWK(RFC_9421_ED25519_TEST_KEY), {
    keyid: RFC_9421_ED25519_TEST_KEY.kid,
    created: new Date(),
  });

  return new Request(request, {
    headers: { ...Object.fromEntries(request.headers), ...headers },
  });
}

describe("verifyWebBotAuthRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifica correctamente un request firmado con una clave que existe en el JWKS", async () => {
    const signedRequest = await buildSignedRequest();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [PUBLIC_ONLY_JWK] }), { status: 200 })
    );

    const result = await verifyWebBotAuthRequest(signedRequest);

    expect(result.verified).toBe(true);
    expect(result.agentKeyId).toBe("test-key-ed25519");
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
    const signedRequest = await buildSignedRequest();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [] }), { status: 200 })
    );

    const result = await verifyWebBotAuthRequest(signedRequest);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("keyid_not_in_jwks");
  });

  it("usa el cache KV si esta disponible, evitando un fetch repetido", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [PUBLIC_ONLY_JWK] }), { status: 200 })
    );

    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    await verifyWebBotAuthRequest(await buildSignedRequest(), kv);
    await verifyWebBotAuthRequest(await buildSignedRequest(), kv);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
