// Reglas de headers Web Bot Auth (draft-03 + RFC 9421), compartidas por los
// dos verificadores via webbotauth/headers.ts. Sin red.
import { describe, expect, it, vi } from "vitest";
import {
  parseSignatureAgent,
  parseWebBotAuthSignatureInput,
  verifyWebBotAuthRequest,
} from "../../packages/trust-layer/src/site-trust/web-bot-auth";
import { verifyWebBotAuthRequest as verifyMiddleware } from "../../packages/trust-layer/src/webbotauth/verify";

const GOOD_INPUT =
  'sig1=("@authority" "signature-agent");created=1735689600;expires=1735693200;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";tag="web-bot-auth"';

describe("parseSignatureAgent", () => {
  it("acepta solo el sf-string con comillas y https://", () => {
    expect(parseSignatureAgent('"https://agent.example"')).toBe("https://agent.example");
    expect(parseSignatureAgent('  "https://agent.example:8443"  ')).toBe("https://agent.example:8443");
    expect(parseSignatureAgent('"https://agent.example/path"')).toBe("https://agent.example");
  });

  it("rechaza sin comillas, sin esquema, diccionario, http, comillas rotas, credenciales y basura", () => {
    for (const raw of [
      "https://agent.example",
      "https://agent.example/path",
      '"agent.example"',
      'sig1="https://agent.example"',
      '"http://agent.example"',
      "http://agent.example",
      '"https://agent.example',
      'https://agent.example"',
      '""',
      '"https://a"b.example"',
      '"https://user:pass@agent.example"',
      '"ftp://agent.example"',
      "",
      null,
    ]) {
      expect(parseSignatureAgent(raw as string | null), String(raw)).toBeNull();
    }
  });
});

describe("parseWebBotAuthSignatureInput", () => {
  it("toma el keyid, los componentes y los parametros tal como llegaron", () => {
    expect(parseWebBotAuthSignatureInput(GOOD_INPUT)).toMatchObject({
      ok: true,
      label: "sig1",
      keyId: "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",
      components: ["@authority", "signature-agent"],
      created: 1735689600,
      expires: 1735693200,
      signatureParams: GOOD_INPUT.slice("sig1=".length),
    });
  });

  it("exige tag=web-bot-auth exacto", () => {
    expect(parseWebBotAuthSignatureInput('sig1=("@authority" "signature-agent");keyid="k"')).toEqual({ ok: false, reason: "missing_web_bot_auth_tag" });
    expect(parseWebBotAuthSignatureInput('sig1=("@authority" "signature-agent");keyid="k";tag="web-bot-auth-x"')).toEqual({
      ok: false,
      reason: "missing_web_bot_auth_tag",
    });
  });

  it("exige keyid en la misma firma", () => {
    expect(parseWebBotAuthSignatureInput('sig1=("@authority" "signature-agent");tag="web-bot-auth"')).toEqual({ ok: false, reason: "missing_keyid" });
  });

  it("exige que signature-agent este firmado", () => {
    expect(parseWebBotAuthSignatureInput('sig1=("@authority");keyid="k";tag="web-bot-auth"')).toEqual({
      ok: false,
      reason: "signature_agent_not_signed",
    });
  });

  it("rechaza componentes con parametros y componentes no soportados", () => {
    for (const p of ["sf", "key=\"a\"", "bs", "req", "tr"]) {
      expect(parseWebBotAuthSignatureInput(`sig1=("@authority" "signature-agent";${p});keyid="k";tag="web-bot-auth"`), p).toEqual({
        ok: false,
        reason: "unsupported_component_parameter",
      });
    }
    expect(parseWebBotAuthSignatureInput('sig1=("@status" "signature-agent");keyid="k";tag="web-bot-auth"')).toEqual({
      ok: false,
      reason: "unsupported_component",
    });
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

describe("ambos verificadores: rechazos antes de la red", () => {
  function req(headers: Record<string, string>) {
    return new Request("https://site.example/blog/hola/", { headers });
  }

  it("no hacen fetch si Signature-Agent no tiene comillas o falta el tag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const base = { Signature: "sig1=:AAAA:", "Signature-Input": GOOD_INPUT };

    for (const verifyFn of [verifyWebBotAuthRequest, verifyMiddleware]) {
      expect(await verifyFn(req({ ...base, "Signature-Agent": "https://agent.example" }))).toMatchObject({
        verified: false,
        reason: "invalid_signature_agent",
      });
      expect(
        await verifyFn(
          req({ ...base, "Signature-Agent": '"https://agent.example"', "Signature-Input": 'sig1=("@authority" "signature-agent");keyid="k"' })
        )
      ).toMatchObject({ verified: false, reason: "missing_web_bot_auth_tag" });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
