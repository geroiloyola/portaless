// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v5 (esta sesion, quinto hallazgo):
//
// 1. Timestamps: se pasa Unix timestamp en segundos (created/expires
//    como number) en vez de objetos Date -- varias libs de firmas HTTP
//    esperan segundos enteros, no instancias Date, y un objeto Date sin
//    convertir puede generar NaN silencioso en la base de la firma.
// 2. Reconstruccion robusta contra case-sensitivity de headers: en vez
//    de asumir las claves exactas "Signature"/"Signature-Input", se
//    itera sobre Object.entries(headers) devueltas por signatureHeaders()
//    y se aplican con .set() sobre un clone() del request original
//    (preservando Signature-Agent, que ya estaba en el request).
// 3. Diagnostico explicito: si verified es false, el test lanza con el
//    campo `reason` exacto que devuelve verifyWebBotAuthRequest() (ver
//    modulo real: WebBotAuthVerificationResult.reason), en vez de fallar
//    con un "expected false to be true" opaco. Esto reemplaza cualquier
//    necesidad de leer node_modules a ciegas -- el propio test ahora
//    reporta la causa raiz real si algo sigue mal.
//
// NOTA: la propiedad correcta del resultado es `agentKeyId` (ver
// WebBotAuthVerificationResult en web-bot-auth.ts) -- se mantiene igual
// que en los tests que ya pasaban, sin cambiar a otra propiedad inexistente.

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

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;

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
