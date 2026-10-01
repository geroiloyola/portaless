// Lectura de headers Web Bot Auth (PR C): Signature-Agent segun draft-03 y
// keyid tomado de la firma con tag="web-bot-auth". Sin red: todos los casos
// se resuelven antes del fetch del directorio de claves.
import { describe, expect, it, vi } from "vitest";
import {
  parseSignatureAgent,
  parseWebBotAuthSignatureInput,
  verifyWebBotAuthRequest,
} from "../../packages/trust-layer/src/site-trust/web-bot-auth";

const GOOD_INPUT =
  'sig1=("@authority" "signature-agent");created=1735689600;expires=1735693200;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";tag="web-bot-auth"';

describe("parseSignatureAgent", () => {
  it("acepta draft-03 con comillas, sin esquema y la forma vieja sin comillas", () => {
    expect(parseSignatureAgent('"https://agent.example"')).toBe("https://agent.example");
    expect(parseSignatureAgent('"agent.example"')).toBe("https://agent.example");
    expect(parseSignatureAgent("https://agent.example/path")).toBe("https://agent.example");
    expect(parseSignatureAgent('  "https://agent.example:8443"  ')).toBe("https://agent.example:8443");
  });

  it("rechaza diccionario, http, comillas rotas, credenciales y basura", () => {
    for (const raw of [
      'sig1="https://agent.example"',
      '"http://agent.example"',
      "http://agent.example",
      '"https://agent.example',
      'https://agent.example"',
      '""',
      '"https://a"b.example"',
      "https://user:pass@agent.example",
      "ftp://agent.example",
      "",
      null,
    ]) {
      expect(parseSignatureAgent(raw as string | null), String(raw)).toBeNull();
    }
  });
});

describe("parseWebBotAuthSignatureInput", () => {
  it("toma el keyid de la firma con tag web-bot-auth", () => {
    expect(parseWebBotAuthSignatureInput(GOOD_INPUT)).toEqual({
      ok: true,
      label: "sig1",
      keyId: "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",
    });
  });

  it("exige tag=web-bot-auth exacto", () => {
    expect(parseWebBotAuthSignatureInput('sig1=("@authority");keyid="k"')).toEqual({ ok: false, reason: "missing_web_bot_auth_tag" });
    expect(parseWebBotAuthSignatureInput('sig1=("@authority");keyid="k";tag="web-bot-auth-x"')).toEqual({
      ok: false,
      reason: "missing_web_bot_auth_tag",
    });
  });

  it("exige keyid en la misma firma", () => {
    expect(parseWebBotAuthSignatureInput('sig1=("@authority");tag="web-bot-auth"')).toEqual({ ok: false, reason: "missing_keyid" });
  });

  it("rechaza mas de una firma, aunque una tenga el tag", () => {
    const mixed = `sig2=("@authority");keyid="otra", ${GOOD_INPUT}`;
    expect(parseWebBotAuthSignatureInput(mixed)).toEqual({ ok: false, reason: "multiple_signatures_unsupported" });
  });

  it("rechaza headers vacios o sin formato", () => {
    expect(parseWebBotAuthSignatureInput("")).toEqual({ ok: false, reason: "missing_signature_input" });
    expect(parseWebBotAuthSignatureInput('keyid="k";tag="web-bot-auth"')).toEqual({ ok: false, reason: "missing_signature_input" });
  });
});

describe("verifyWebBotAuthRequest: rechazos antes de la red", () => {
  function req(headers: Record<string, string>) {
    return new Request("https://site.example/blog/hola/", { headers });
  }

  it("no hace fetch si Signature-Agent es invalido o falta el tag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const base = { Signature: "sig1=:AAAA:", "Signature-Input": GOOD_INPUT };

    expect(await verifyWebBotAuthRequest(req({ ...base, "Signature-Agent": '"http://agent.example"' }))).toMatchObject({
      verified: false,
      reason: "invalid_signature_agent",
    });
    expect(
      await verifyWebBotAuthRequest(
        req({ ...base, "Signature-Agent": '"https://agent.example"', "Signature-Input": 'sig1=("@authority");keyid="k"' })
      )
    ).toMatchObject({ verified: false, reason: "missing_web_bot_auth_tag" });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
