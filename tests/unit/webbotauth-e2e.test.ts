// Verificacion de punta a punta de verifyWebBotAuthRequest() con una firma
// Ed25519 REAL generada por la libreria oficial (signatureHeaders +
// signerFromJWK de web-bot-auth). Sin mocks de criptografia: solo se
// reemplaza el fetch del directorio de claves del agente.
//
// Clave: la de prueba de RFC 9421 Appendix B.1.4, publicada en el README de
// web-bot-auth. Es publica a proposito; nunca usarla fuera de tests.
//
// El keyid no se escribe a mano: la libreria usa el thumbprint del JWK, asi
// que se lee del Signature-Input generado y el directorio responde la clave
// con ese kid.
//
// Si "rechaza una firma vencida" falla, verify() no esta controlando
// expires y se aceptan replays: es un hallazgo de seguridad, no un test roto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import {
  parseWebBotAuthSignatureInput,
  verifyWebBotAuthRequest,
} from "../../packages/trust-layer/src/site-trust/web-bot-auth";

const RFC_9421_ED25519_TEST_KEY = {
  kty: "OKP",
  crv: "Ed25519",
  kid: "test-key-ed25519",
  d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
  x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
};
const { d: _private, ...PUBLIC_KEY } = RFC_9421_ED25519_TEST_KEY;

const SITE_URL = "https://site.example/blog/hola/";
const AGENT = '"https://agent.example"';
const DIRECTORY_URL = "https://agent.example/.well-known/http-message-signatures-directory";

async function signFor(url: string, created: Date, expires: Date) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = await signerFromJWK(RFC_9421_ED25519_TEST_KEY as any);
  const h = await signatureHeaders(new Request(url), signer, { created, expires });
  const headers = {
    Signature: h["Signature"],
    "Signature-Input": h["Signature-Input"],
    "Signature-Agent": AGENT,
  };
  const parsed = parseWebBotAuthSignatureInput(headers["Signature-Input"]);
  if (!parsed.ok) throw new Error(`Signature-Input generado no compatible con el verificador: ${parsed.reason}`);
  return { headers, keyId: parsed.keyId };
}

function mockDirectory(keys: object[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { "content-type": "application/http-message-signatures-directory+json" },
    })
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyWebBotAuthRequest de punta a punta (Ed25519 real)", () => {
  it("verifica una firma valida generada por la libreria oficial", async () => {
    const now = new Date();
    const { headers, keyId } = await signFor(SITE_URL, now, new Date(now.getTime() + 60_000));
    const fetchSpy = mockDirectory([{ ...PUBLIC_KEY, kid: keyId }]);

    const result = await verifyWebBotAuthRequest(new Request(SITE_URL, { headers }));

    expect(result).toMatchObject({ verified: true, agentKeyId: keyId, keyAlgorithm: "ed25519" });
    expect(String(fetchSpy.mock.calls[0][0])).toBe(DIRECTORY_URL);
  });

  it("rechaza la misma firma reenviada a otro host", async () => {
    const now = new Date();
    const { headers, keyId } = await signFor(SITE_URL, now, new Date(now.getTime() + 60_000));
    mockDirectory([{ ...PUBLIC_KEY, kid: keyId }]);

    const result = await verifyWebBotAuthRequest(new Request("https://otro.example/blog/hola/", { headers }));

    expect(result.verified).toBe(false);
  });

  it("rechaza un keyid que no esta en el directorio del agente", async () => {
    const now = new Date();
    const { headers, keyId } = await signFor(SITE_URL, now, new Date(now.getTime() + 60_000));
    mockDirectory([{ ...PUBLIC_KEY, kid: "otra-clave" }]);

    const result = await verifyWebBotAuthRequest(new Request(SITE_URL, { headers }));

    expect(result).toMatchObject({ verified: false, agentKeyId: keyId, reason: "keyid_not_in_jwks" });
  });

  it("rechaza una firma vencida", async () => {
    const now = Date.now();
    const { headers, keyId } = await signFor(SITE_URL, new Date(now - 10 * 60_000), new Date(now - 5 * 60_000));
    mockDirectory([{ ...PUBLIC_KEY, kid: keyId }]);

    const result = await verifyWebBotAuthRequest(new Request(SITE_URL, { headers }));

    expect(result.verified).toBe(false);
  });
});
