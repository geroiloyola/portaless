// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v7 (esta sesion, septimo hallazgo -- el
// diagnostico explicito agregado en v6 dio fruto): con created/expires
// como Date, la firma se genera y verify() la acepta criptograficamente
// -- pero verifyWebBotAuthRequest() devolvia reason: "keyid_not_in_jwks".
// El modulo real extrae el keyid con un regex literal sobre el header
// Signature-Input:
//
//   const match = sigInput.match(/keyid="([^"]+)"/);
//
// v4/v5/v6 habian quitado la opcion `keyid` de signatureHeaders(),
// asumiendo (por el ejemplo textual de npmjs.com/package/web-bot-auth)
// que se derivaba automaticamente del campo `kid` del JWK. Esa asuncion
// era incorrecta para esta version instalada: sin `keyid` explicito, el
// Signature-Input generado no incluye keyid="..." en el formato que el
// regex de extractKeyId() espera, y el lookup en el JWKS mockeado no
// encuentra ninguna clave. Se reincorpora `keyid` explicitamente en las
// opciones de firma.
//
// Se mantienen las mejoras validas de v6/v5: created/expires como Date,
// reconstruccion case-insensitive de headers, y el throw explicito con
// el `reason` real -- que fue justamente lo que permitio aislar esta
// causa raiz sin seguir adivinando a ciegas.

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
    keyid: RFC_9421_ED25519_TEST_KEY.kid,
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
