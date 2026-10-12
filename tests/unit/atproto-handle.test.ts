// Sintaxis de handles AT Protocol -- tablas de ejemplos VERBATIM del spec
// https://atproto.com/specs/handle ("Identifier Examples"): si el spec
// dice que un ejemplo es valido/invalido, este validador tiene que
// coincidir. Mas cobertura de normalizacion (@ de UI, mayusculas, TLDs
// reservados) y de candidatos APW.

import { describe, it, expect } from "vitest";
import {
  parseHandle,
  resolvableHandle,
  isValidHandleSyntax,
  handleTld,
  atUriFromHandle,
  handleFromAtUri,
  apwCandidateDomains,
  MAX_HANDLE_LENGTH,
  RESERVED_TLDS,
} from "../../packages/identity-atproto/src/handle";

describe("parseHandle -- ejemplos VALIDOS del spec", () => {
  const valid = [
    "jay.bsky.social",
    "8.cn",
    "name.t--t",
    "XX.LCS.MIT.EDU",
    "a.co",
    "xn--notarealidn.com",
    "xn--fiqa61au8b7zsevnm8ak20mc4a87e.xn--fiqs8s",
    "example.t",
    "username.wikipedia.org",
  ];

  for (const handle of valid) {
    it(`acepta "${handle}" (case-insensitive -> minusculas)`, () => {
      const result = parseHandle(handle);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.handle).toBe(handle.toLowerCase());
    });
  }
});

describe("parseHandle -- ejemplos INVALIDOS del spec", () => {
  const invalid = [
    "jo@hn.test",
    "💩.test",
    "john..test",
    "xn--bcher-.tld",
    "john.0",
    "cn.8",
    "www.masełkowski.pl.com",
    "org",
    "name.org.",
    "no-dots",
    "",
  ];

  for (const handle of invalid) {
    it(`rechaza ${JSON.stringify(handle)}`, () => {
      expect(parseHandle(handle).ok).toBe(false);
    });
  }

  it("rechaza no-strings", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(parseHandle(value).ok).toBe(false);
    }
  });

  it("trim de UI: un espacio accidental al inicio/final se recorta (el VALOR del handle jamas lleva espacios)", () => {
    expect(parseHandle(" leading.space.com")).toEqual({ ok: true, handle: "leading.space.com" });
    expect(parseHandle("trailing.space.com ")).toEqual({ ok: true, handle: "trailing.space.com" });
    expect(parseHandle(" ali ce.bsky.social ").ok).toBe(false);
  });
});

describe("parseHandle -- normalizacion desde UI", () => {
  it("descarta el '@' inicial (UI solamente, no valido en backend)", () => {
    const result = parseHandle("@Alice.Bsky.Social");
    expect(result).toEqual({ ok: true, handle: "alice.bsky.social" });
  });

  it("el '@' interno NO es valido", () => {
    expect(parseHandle("ali@ce.bsky.social").ok).toBe(false);
  });

  it("acepta el maximo de 253 y rechaza 254", () => {
    const label = "a".repeat(61);
    const base = [label, label, label, label].join(".");
    // base: 4*61 + 3 = 247 chars; agregamos un segmento de 5 -> 253
    const at253 = `${base}.abcde`;
    expect(at253.length).toBe(253);
    expect(parseHandle(at253).ok).toBe(true);
    expect(parseHandle(`${at253}f`).ok).toBe(false);
    expect(MAX_HANDLE_LENGTH).toBe(253);
  });
});

describe("resolvableHandle -- TLDs reservados", () => {
  const reservedExamples = [
    "laptop.local",
    "blah.arpa",
    "server.internal",
    "thing.invalid",
    "foo.onion",
    "foo.alt",
    "user.test",
    "foo.example",
  ];

  for (const handle of reservedExamples) {
    it(`syntax OK pero no resoluble: ${handle}`, () => {
      const syntax = parseHandle(handle);
      expect(syntax.ok).toBe(true);
      const resolvable = resolvableHandle(handle);
      expect(resolvable).toEqual({ ok: false, reason: "reserved_tld" });
    });
  }

  it("un dominio bajo un TLD comun NO esta reservado", () => {
    expect(resolvableHandle("user.example.com").ok).toBe(true);
    expect(resolvableHandle("username.wikipedia.org").ok).toBe(true);
  });

  it("el TLD reservado afecta al ULTIMO segmento, no a segmentos internos", () => {
    expect(resolvableHandle("test.example.com").ok).toBe(true);
    expect(handleTld("test.example.com")).toBe("com");
    expect(RESERVED_TLDS.has("com")).toBe(false);
  });
});

describe("at:// URIs", () => {
  it("construye y parsea el URI estandar", () => {
    expect(atUriFromHandle("alice.bsky.social")).toBe("at://alice.bsky.social");
    expect(handleFromAtUri("at://alice.bsky.social")).toBe("alice.bsky.social");
  });

  it("acepta el '@' de display en el URI", () => {
    expect(handleFromAtUri("at://@alice.bsky.social")).toBe("alice.bsky.social");
  });

  it("rechaza URIs con path/query/fragment o que no son at://", () => {
    expect(handleFromAtUri("at://alice.bsky.social/app.kv.record")).toBeNull();
    expect(handleFromAtUri("at://alice.bsky.social?x=1")).toBeNull();
    expect(handleFromAtUri("at://alice.bsky.social#frag")).toBeNull();
    expect(handleFromAtUri("did:plc:abc")).toBeNull();
    expect(handleFromAtUri("https://alice.bsky.social")).toBeNull();
    expect(handleFromAtUri(123)).toBeNull();
  });

  it("rechaza handles sintacticamente invalidos dentro del URI", () => {
    expect(handleFromAtUri("at://org")).toBeNull();
    expect(handleFromAtUri("at://john..test")).toBeNull();
  });
});

describe("apwCandidateDomains", () => {
  it("sufijos de mas especifico a menos, sin el TLD desnudo", () => {
    expect(apwCandidateDomains("username.wikipedia.org")).toEqual([
      "username.wikipedia.org",
      "wikipedia.org",
    ]);
  });

  it("handle de dos segmentos -> solo el dominio completo", () => {
    expect(apwCandidateDomains("example.com")).toEqual(["example.com"]);
  });

  it("subdominio profundo", () => {
    expect(apwCandidateDomains("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
    ]);
  });
});

describe("isValidHandleSyntax", () => {
  it("coincide con parseHandle para syntax", () => {
    expect(isValidHandleSyntax("alice.bsky.social")).toBe(true);
    expect(isValidHandleSyntax("nope")).toBe(false);
  });
});
