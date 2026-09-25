// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v8 (esta sesion, octavo hallazgo -- cierre
// del diagnostico leyendo el codigo fuente real instalado en node_modules,
// no por inferencia): la causa raiz nunca fue `created`/`expires`, `tag`,
// `fields` ni el nombre del import. Es esta:
//
// `SignatureParams` (el tercer argumento de signatureHeaders()) NO tiene
// campo `keyid` -- su forma real, segun dist/index.d.ts, es solo
// `{ created, expires, nonce?, key? }`. Cualquier `keyid` que le
// pasemos ahi se ignora en silencio (JS no valida props extra), que es
// por lo que v5/v7 con `keyid: RFC_9421_ED25519_TEST_KEY.kid` no tuvo
// ningun efecto pese a parecer razonable.
//
// El keyid que termina realmente en el header Signature-Input SIEMPRE
// sale de `signer.keyid`, fijado dentro de `Ed25519Signer.fromJWK()`
// (ver dist/chunk-*.mjs):
//
//   const keyid = await jwkToKeyID(jwk, WEBCRYPTO_SHA256, BASE64URL_DECODE);
//   return new Ed25519Signer(keyid, key);
//
// jwkToKeyID (el paquete `jsonwebkey-thumbprint`) calcula el thumbprint
// SHA-256 del JWK segun RFC 7638 -- IGNORA por completo el campo `kid`
// que el JWK ya trae escrito. Verificado empiricamente instalando
// web-bot-auth@0.1.0 en un entorno aislado: para esta clave de test, el
// signer.keyid real es el thumbprint calculado, nunca el string
// "test-key-ed25519" que el JWK de prueba declara.
//
// Por eso `verifyWebBotAuthRequest()` devolvia siempre reason:
// "keyid_not_in_jwks" -- el JWKS mockeado publicaba un JWK con
// `kid: "test-key-ed25519"` (arbitrario), pero el Signature-Input real
// llevaba `keyid="<thumbprint-real>"`. selectKeyByKeyId() nunca podia
// encontrar coincidencia por mas que cambiaramos date vs timestamp,
// tag, o fields -- la firma criptografica siempre fue valida, el unico
// problema era el key lookup por un `kid` que no correspondia.
//
// Fix: capturar `signer.keyid` (el thumbprint real) despues de crear el
// signer, y usar ESE valor -- no un string fijo -- como `kid` del JWK
// publico que se publica en el mock del JWKS para el test positivo y
// para el de cache KV (los unicos dos que esperan verified:true).
//
// Se mantienen las mejoras validas de v5/v6: created/expires como Date,
// reconstruccion case-insensitive de headers via Object.entries(), y el
// throw explicito con el `reason` real -- fue justamente ese diagnostico
// el que permitio descartar canonicalizacion y aislar el key lookup como
// unica causa.

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

const SIGNATURE_AGENT_URL = "https://agent.example.test";

// Firma el request y devuelve tanto el Request final como el keyid REAL
// (thumbprint) que la libreria uso -- necesario para publicar un JWKS
// mockeado que realmente matchee.
async function buildSignedRequest(): Promise<{ request: Request; realKeyId: string }> {
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
  });

  const finalRequest = request.clone();
  for (const [k, v] of Object.entries(headers)) {
    finalRequest.headers.set(k, v as string);
  }

  return { request: finalRequest, realKeyId: signer.keyid };
}

// JWK publico con el `kid` igual al thumbprint real que calculo el
// signer -- no al `kid` arbitrario que trae RFC_9421_ED25519_TEST_KEY.
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
      throw new Error(`La verificacion fallo. Razon exacta devuelta por verifyWebBotAuthRequest: ${result.reason}`);
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
