// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v6 (esta sesion, sexto hallazgo): el fix
// v5 cambio created/expires a Unix timestamps en segundos (number),
// asumiendo que la libreria los esperaba asi. El error real de CI fue
// "params.created.getTime is not a function" -- confirma que
// getSigningOptions() SI llama a .getTime() sobre `created`, es decir
// SI espera un objeto Date real, no un number. Se revierte ese cambio
// puntual a Date (como en v2/v3/v4, que nunca tuvieron este TypeError).
//
// Se mantienen las dos mejoras validas de v5, que nunca fueron la causa
// de ningun fallo:
//   1. Reconstruccion case-insensitive de headers (iterar
//      Object.entries() + .set() sobre un .clone(), en vez de asumir las
//      claves literales "Signature"/"Signature-Input").
//   2. Throw explicito con el `reason` real de verifyWebBotAuthRequest()
//      si verified es false, para que el proximo fallo (si lo hay)
//      diga la causa exacta en vez de "expected false to be true".

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

  const created = new Date();
  const expires = new Date(created.getTime() + 300_000);

  const signer = await signerFromJWK(RFC_9421_ED25519_TEST_KEY);

  const headers = await signatureHeaders(request.clone(), signer, {
    created,
    expires,
  } as any);

  const finalRequest = request.clone();
  for (const [k, v] of Object.entries(headers)) {
    finalRequest.headers.set(k, v as string);
  }

  return finalRequest;
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

    if (!result.verified) {
      throw new Error(`La verificacion fallo. Razon exacta devuelta por verifyWebBotAuthRequest: ${result.reason}`);
    }

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
