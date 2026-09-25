// Tests de verifyWebBotAuthRequest() usando la clave de test oficial de
// RFC 9421 Appendix B.1.4. FIX v3 (esta sesion, tercer hallazgo de CI):
// verified quedaba en false (sin lanzar) porque a la firma le faltaban
// dos elementos que el perfil Web Bot Auth exige explicitamente --ver
// draft-ietf-webbotauth-httpsig-protocol y el ejemplo oficial de
// Cloudflare en blog.cloudflare.com/verified-bots-with-cryptography/--:
//
//   Signature-Input: sig=("@authority" "signature-agent");
//     created=...; expires=...; keyid="..."; tag="web-bot-auth"
//
// 1. `tag: "web-bot-auth"` es obligatorio en las opciones de firma (la
//    spec lo llama MUST). Sin el, verify() del lado del verificador no
//    reconoce la firma como conforme al perfil Web Bot Auth.
// 2. El componente "signature-agent" (el header del mismo nombre) DEBE
//    estar cubierto por la firma -- se declara con `fields` en las
//    opciones de signatureHeaders(). Sin esto, la base string que firma
//    el signer no coincide con la que reconstruye el verificador al leer
//    Signature-Input, y verify() rechaza la firma en silencio.
//
// Los fixes v1 (created) y v2 (expires) eran necesarios pero no
// suficientes -- resolvian el TypeError de getSigningOptions, pero no
// alcanzaban para que verify() aceptara la firma como valida.

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
    keyid: RFC_9421_ED25519_TEST_KEY.kid,
    created,
    expires,
    tag: "web-bot-auth",
    fields: ["@authority", "signature-agent"],
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
