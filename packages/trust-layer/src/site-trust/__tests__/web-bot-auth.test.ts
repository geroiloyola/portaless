// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v4 (esta sesion, cuarto hallazgo de CI):
// v1/v2/v3 agregaron created, expires, tag y fields sin exito -- verified
// seguia false sin lanzar. Comparando contra el ejemplo oficial textual
// de npmjs.com/package/web-bot-auth (seccion "Signing"/"Verifying"), se
// detecto que:
//
// 1. `keyid` NUNCA fue una opcion valida de signatureHeaders() -- el
//    keyid se deriva automaticamente del campo `kid` del JWK pasado a
//    signerFromJWK(). Pasarlo como opcion no rompe nada (se ignora) pero
//    tampoco ayuda.
// 2. El ejemplo oficial de signing solo pasa { created, expires } -- sin
//    tag ni fields. Se remueven esas opciones no documentadas por si la
//    version instalada las trata de forma inesperada.
// 3. El request que se firma DEBE incluir el header Signature-Agent
//    *antes* de llamar a signatureHeaders(), para que la libreria lo
//    detecte automaticamente y lo incluya como componente firmado (asi
//    lo hace el ejemplo con Signature-Agent en draft-meunier-web-bot-
//    auth-architecture-05, seccion de vectores de prueba). El test ya
//    hacia esto correctamente desde el principio.
// 4. Se simplifica la reconstruccion final del signedRequest para seguir
//    el patron oficial exacto: un Request nuevo con Signature-Agent +
//    Signature + Signature-Input, en vez de mezclar todos los headers
//    originales via Object.fromEntries -- para eliminar cualquier
//    interferencia de headers no relacionados en la reconstruccion de
//    la base de firma que hace verify().

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

  const headers = await signatureHeaders(request, await signerFromJWK(RFC_9421_ED25519_TEST_KEY), {
    created,
    expires,
  });

  return new Request(request.url, {
    method: request.method,
    headers: {
      "Signature-Agent": SIGNATURE_AGENT_URL,
      Signature: headers["Signature"],
      "Signature-Input": headers["Signature-Input"],
    },
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
