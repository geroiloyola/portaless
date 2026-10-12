// Resolucion AT Protocol (specs oficiales handle + DID) con fetch
// mockeado -- cero red real en tests (convencion del repo; las llamadas a
// plc.directory/handles/DoH quedan como limite "External" documentado).
// Cubre: TXT preferido, fallback HTTPS, ambiguedad, verificacion
// bidireccional (link_mismatch), did:plc/did:web, claves Multikey y
// legacy, limites de tamano, y red caida.

import { describe, it, expect } from "vitest";
import {
  resolveHandleToDid,
  resolveDidDocument,
  resolveAtprotoIdentity,
  parseAtprotoDid,
  claimedHandlesFromDocument,
  extractAtprotoSigningKey,
  extractPdsEndpoint,
  base58btcDecode,
  decodeMultibaseKey,
  parseDohTxtData,
} from "../../packages/identity-atproto/src/resolve";

type RouteHandler = string | { status?: number; body?: string; headers?: Record<string, string> } | Error;

/** fetch mockeado por URL exacta o substring. Devuelve tambien el log de llamadas. */
function makeFetch(routes: Array<[string | RegExp, RouteHandler]>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [match, handler] of routes) {
      const hit = match instanceof RegExp ? match.test(url) : url.includes(match);
      if (!hit) continue;
      if (handler instanceof Error) throw handler;
      if (typeof handler === "string") {
        return new Response(handler, { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(handler.body ?? "", {
        status: handler.status ?? 200,
        headers: { "content-type": "application/json", ...handler.headers },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function txtDoh(did: string | string[]): [string | RegExp, RouteHandler] {
  const answer = (Array.isArray(did) ? did : [did]).map((d) => ({ name: "_atproto.x", type: 16, data: `"did=${d}"` }));
  return [
    /cloudflare-dns\.com\/dns-query/,
    JSON.stringify({ Status: 0, Answer: answer }),
  ];
}

const PLC_DID = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";

function plcDoc(extra: Record<string, unknown> = {}): RouteHandler {
  return {
    body: JSON.stringify({
      id: PLC_DID,
      alsoKnownAs: ["at://alice.bsky.social"],
      verificationMethod: [
        {
          id: `${PLC_DID}#atproto`,
          type: "Multikey",
          controller: PLC_DID,
          publicKeyMultibase: ed25519Multibase(new Uint8Array(32).fill(7)),
        },
      ],
      service: [
        { id: `${PLC_DID}#atproto_pds`, type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" },
      ],
      ...extra,
    }),
  };
}

/** Multibase z + base58btc de multicodec ed01 + clave (para construir vectores). */
function ed25519Multibase(key: Uint8Array): string {
  const prefixed = new Uint8Array(2 + key.length);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(key, 2);
  return `z${base58Encode(prefixed)}`;
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  let out = "";
  while (num > 0n) {
    out = alphabet[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

describe("parseAtprotoDid", () => {
  it("acepta solo metodos blessed con sintaxis AT", () => {
    expect(parseAtprotoDid("did:plc:abc123")).toEqual({ ok: true, did: "did:plc:abc123", method: "plc" });
    expect(parseAtprotoDid("did:web:user.example.com")).toEqual({
      ok: true,
      did: "did:web:user.example.com",
      method: "web",
    });
  });

  it("rechaza metodos no-blessed, sintaxis invalida y no-strings", () => {
    expect(parseAtprotoDid("did:ethr:0xabc").ok).toBe(false);
    expect(parseAtprotoDid("did:METHOD:x").ok).toBe(false);
    expect(parseAtprotoDid("did:plc:").ok).toBe(false);
    expect(parseAtprotoDid("did:plc:val/two").ok).toBe(false);
    expect(parseAtprotoDid("DID:plc:val").ok).toBe(false);
    expect(parseAtprotoDid(null).ok).toBe(false);
  });
});

describe("resolveHandleToDid -- metodo TXT (preferido)", () => {
  it("resuelve por TXT sin tocar HTTPS", async () => {
    const { fetchImpl, calls } = makeFetch([txtDoh(PLC_DID)]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "txt" });
    expect(calls.some((u) => u.includes("atproto-did"))).toBe(false);
  });

  it("TXT y HTTPS discrepan -> gana TXT (spec)", async () => {
    const { fetchImpl } = makeFetch([
      txtDoh(PLC_DID),
      ["alice.bsky.social/.well-known/atproto-did", "did:plc:otrodidquenoeselcorrecto"],
    ]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "txt" });
  });

  it("TXT con dos DID distintos -> ambiguo y sin fallback (spec: resolution should fail)", async () => {
    const { fetchImpl, calls } = makeFetch([
      txtDoh([PLC_DID, "did:plc:segundodid"]),
      ["alice.bsky.social/.well-known/atproto-did", PLC_DID],
    ]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "ambiguous_txt" });
    expect(calls.some((u) => u.includes("atproto-did"))).toBe(false);
  });

  it("TXT repetido con el MISMO DID no es ambiguo", async () => {
    const { fetchImpl } = makeFetch([txtDoh([PLC_DID, PLC_DID])]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "txt" });
  });

  it("TXT sin registros did= (o con basura) -> fallback a HTTPS", async () => {
    const { fetchImpl } = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0, Answer: [{ type: 16, data: '"v=spf1 -all"' }] }) ],
      ["alice.bsky.social/.well-known/atproto-did", `${PLC_DID}\n`],
    ]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "https" });
  });
});

describe("resolveHandleToDid -- metodo HTTPS well-known", () => {
  it("DID con whitespace alrededor se recorta (spec)", async () => {
    const { fetchImpl } = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", `  ${PLC_DID}  `],
    ]);
    const result = await resolveHandleToDid("alice.bsky.social", { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "https" });
  });

  it("handle largo (>244) salte DoH (query DNS >253) y va directo a HTTPS", async () => {
    const longHandle = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(55)}.com`;
    expect(longHandle.length).toBeGreaterThan(244);
    expect(longHandle.length).toBeLessThanOrEqual(253);
    const { fetchImpl, calls } = makeFetch([[`${longHandle}/.well-known/atproto-did`, PLC_DID]]);
    const result = await resolveHandleToDid(longHandle, { fetchImpl });
    expect(result).toEqual({ ok: true, did: PLC_DID, resolvedBy: "https" });
    expect(calls.some((u) => u.includes("cloudflare-dns"))).toBe(false);
  });

  it("respuesta no-2xx -> handle_unresolvable", async () => {
    const { fetchImpl } = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", { status: 404, body: "nope" }],
    ]);
    expect(await resolveHandleToDid("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "handle_unresolvable",
    });
  });

  it("red caida -> upstream_error", async () => {
    const { fetchImpl } = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", new Error("network down")],
    ]);
    expect(await resolveHandleToDid("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "upstream_error",
    });
  });

  it("body gigante -> response_too_large", async () => {
    const { fetchImpl } = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", "x".repeat(2048)],
    ]);
    expect(await resolveHandleToDid("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "response_too_large",
    });
  });

  it("body que no es DID -> handle_unresolvable; DID de metodo no-blessed -> unsupported", async () => {
    const base = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", "<html>hola</html>"],
    ]);
    expect(await resolveHandleToDid("alice.bsky.social", { fetchImpl: base.fetchImpl })).toEqual({
      ok: false,
      reason: "handle_unresolvable",
    });

    const eth = makeFetch([
      [ /cloudflare-dns\.com/, JSON.stringify({ Status: 0 }) ],
      ["alice.bsky.social/.well-known/atproto-did", "did:ethr:0x1234"],
    ]);
    expect(await resolveHandleToDid("alice.bsky.social", { fetchImpl: eth.fetchImpl })).toEqual({
      ok: false,
      reason: "unsupported_did_method",
    });
  });

  it("handle invalido o reservado no gasta fetch", async () => {
    const { fetchImpl, calls } = makeFetch([]);
    expect(await resolveHandleToDid("nope", { fetchImpl })).toEqual({ ok: false, reason: "invalid_handle" });
    expect(await resolveHandleToDid("x.local", { fetchImpl })).toEqual({ ok: false, reason: "reserved_tld" });
    expect(calls).toHaveLength(0);
  });
});

describe("resolveDidDocument -- did:plc y did:web", () => {
  it("did:plc via plc.directory", async () => {
    const { fetchImpl, calls } = makeFetch([[`plc.directory/${PLC_DID}`, plcDoc()]]);
    const result = await resolveDidDocument(PLC_DID, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain(`https://plc.directory/${PLC_DID}`);
  });

  it("did:web hostname-level via /.well-known/did.json", async () => {
    const { fetchImpl, calls } = makeFetch([
      ["user.example.com/.well-known/did.json", { body: JSON.stringify({ id: "did:web:user.example.com" }) }],
    ]);
    const result = await resolveDidDocument("did:web:user.example.com", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(calls[0]).toBe("https://user.example.com/.well-known/did.json");
  });

  it("did:web con puerto/path -> did_web_unsupported (AT: solo hostname)", async () => {
    const { fetchImpl, calls } = makeFetch([]);
    expect(await resolveDidDocument("did:web:localhost:8443", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_web_unsupported",
    });
    expect(await resolveDidDocument("did:web:user.example.com%3Apath", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_web_unsupported",
    });
    expect(calls).toHaveLength(0);
  });

  it("did:web con TLD reservado -> did_web_unsupported", async () => {
    const { fetchImpl } = makeFetch([]);
    expect(await resolveDidDocument("did:web:foo.local", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_web_unsupported",
    });
  });

  it("404 -> did_not_found; red caida -> did_unreachable", async () => {
    const nf = makeFetch([[`plc.directory/${PLC_DID}`, { status: 404, body: "{}" }]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl: nf.fetchImpl })).toEqual({
      ok: false,
      reason: "did_not_found",
    });

    const down = makeFetch([[`plc.directory/${PLC_DID}`, new Error("boom")]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl: down.fetchImpl })).toEqual({
      ok: false,
      reason: "did_unreachable",
    });
  });

  it("id del documento != DID pedido -> did_mismatch", async () => {
    const { fetchImpl } = makeFetch([[`plc.directory/${PLC_DID}`, { body: JSON.stringify({ id: "did:plc:otro" }) }]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl })).toEqual({ ok: false, reason: "did_mismatch" });
  });

  it("JSON basura / sin id -> malformed_document; body gigante -> response_too_large", async () => {
    const garbage = makeFetch([[`plc.directory/${PLC_DID}`, "{no json"]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl: garbage.fetchImpl })).toEqual({
      ok: false,
      reason: "malformed_document",
    });

    const noId = makeFetch([[`plc.directory/${PLC_DID}`, { body: JSON.stringify({ foo: 1 }) }]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl: noId.fetchImpl })).toEqual({
      ok: false,
      reason: "malformed_document",
    });

    const big = makeFetch([[`plc.directory/${PLC_DID}`, { body: JSON.stringify({ id: PLC_DID, x: "y".repeat(70000) }) }]]);
    expect(await resolveDidDocument(PLC_DID, { fetchImpl: big.fetchImpl })).toEqual({
      ok: false,
      reason: "response_too_large",
    });
  });

  it("metodo no-blessed y sintaxis invalida no gastan fetch", async () => {
    const { fetchImpl, calls } = makeFetch([]);
    expect(await resolveDidDocument("did:ethr:0x1", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_method_unsupported",
    });
    expect(await resolveDidDocument("did:plc:", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_syntax_invalid",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("resolveAtprotoIdentity -- verificacion bidireccional", () => {
  it("handle -> DID -> documento que reclama el handle (camino feliz)", async () => {
    const { fetchImpl } = makeFetch([txtDoh(PLC_DID), [`plc.directory/${PLC_DID}`, plcDoc()]]);
    const result = await resolveAtprotoIdentity("@Alice.Bsky.Social", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toMatchObject({
      handle: "alice.bsky.social",
      did: PLC_DID,
      didMethod: "plc",
      resolvedBy: "txt",
      pds: "https://pds.example.com",
    });
    expect(result.identity.claimedHandles).toEqual(["alice.bsky.social"]);
    expect(result.identity.signingKey).toMatchObject({ type: "Multikey" });
  });

  it("el DID no reclama el handle -> link_mismatch (nadie puede alias-ejar cuentas ajenas)", async () => {
    const { fetchImpl } = makeFetch([
      txtDoh(PLC_DID),
      [
        `plc.directory/${PLC_DID}`,
        plcDoc({ alsoKnownAs: ["at://otro.usuario.com"] }),
      ],
    ]);
    expect(await resolveAtprotoIdentity("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "link_mismatch",
    });
  });

  it("documento sin alsoKnownAs -> link_mismatch", async () => {
    const { fetchImpl } = makeFetch([
      txtDoh(PLC_DID),
      [`plc.directory/${PLC_DID}`, plcDoc({ alsoKnownAs: undefined })],
    ]);
    expect(await resolveAtprotoIdentity("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "link_mismatch",
    });
  });

  it("propaga el motivo del handle cuando este falla", async () => {
    const { fetchImpl } = makeFetch([txtDoh(PLC_DID), [`plc.directory/${PLC_DID}`, { status: 404, body: "" }]]);
    expect(await resolveAtprotoIdentity("alice.bsky.social", { fetchImpl })).toEqual({
      ok: false,
      reason: "did_not_found",
    });
  });
});

describe("claimedHandlesFromDocument", () => {
  it("filtra entradas invalidas y preserva el orden (first valid = claimed)", () => {
    const handles = claimedHandlesFromDocument({
      id: "did:plc:x",
      alsoKnownAs: ["at://alice.test", "https://web.example", "at://@bob.example", "at://bad handle", "at://carol.example"],
    });
    expect(handles).toEqual(["alice.test", "bob.example", "carol.example"]);
  });

  it("sin tambienKnownAs o si no es array -> []", () => {
    expect(claimedHandlesFromDocument({ id: "did:plc:x" })).toEqual([]);
    expect(claimedHandlesFromDocument({ id: "did:plc:x", alsoKnownAs: "at://a.example" })).toEqual([]);
  });
});

describe("extractAtprotoSigningKey", () => {
  const did = PLC_DID;
  const goodMultibase = ed25519Multibase(new Uint8Array(32).fill(9));

  it("acepta Multikey moderno con id calificado y con id relativo", () => {
    const qualified = extractAtprotoSigningKey({
      id: did,
      verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: goodMultibase }],
    } as never);
    expect(qualified).toMatchObject({ type: "Multikey", multibase: goodMultibase });

    const relative = extractAtprotoSigningKey({
      id: did,
      verificationMethod: [{ id: "#atproto", type: "Multikey", controller: did, publicKeyMultibase: goodMultibase }],
    } as never);
    expect(relative).toMatchObject({ type: "Multikey", multibase: goodMultibase });
  });

  it("acepta formatos legacy (EcdsaSecp256r1/256k1)", () => {
    const legacyBytes = new Uint8Array(65).fill(3);
    const legacy = `z${base58Encode(legacyBytes)}`;
    for (const type of ["EcdsaSecp256r1VerificationKey2019", "EcdsaSecp256k1VerificationKey2019"]) {
      const key = extractAtprotoSigningKey({
        id: "#atproto",
        verificationMethod: [{ id: "#atproto", type, controller: did, publicKeyMultibase: legacy }],
      } as never);
      expect(key).not.toBeNull();
    }
  });

  it("ignora claves con otro id, otro type o multibase corrupta -> null", () => {
    expect(
      extractAtprotoSigningKey({
        id: did,
        verificationMethod: [{ id: "#signing", type: "Multikey", controller: did, publicKeyMultibase: goodMultibase }],
      } as never)
    ).toBeNull();
    expect(
      extractAtprotoSigningKey({
        id: did,
        verificationMethod: [{ id: "#atproto", type: "JsonWebKey2020", controller: did, publicKeyMultibase: goodMultibase }],
      } as never)
    ).toBeNull();
    expect(
      extractAtprotoSigningKey({
        id: did,
        verificationMethod: [{ id: "#atproto", type: "Multikey", controller: did, publicKeyMultibase: "z000" }],
      } as never)
    ).toBeNull();
    expect(extractAtprotoSigningKey({ id: did } as never)).toBeNull();
    expect(extractAtprotoSigningKey({ id: did, verificationMethod: "nope" } as never)).toBeNull();
  });
});

describe("extractPdsEndpoint", () => {
  const did = PLC_DID;

  it("acepta id relativo y calificado con HTTPS", () => {
    for (const id of [`${did}#atproto_pds`, "#atproto_pds"]) {
      expect(
        extractPdsEndpoint({
          id: did,
          service: [{ id, type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }],
        } as never)
      ).toBe("https://pds.example.com");
    }
  });

  it("rechaza endpoint http (spec: HTTPS), tipo equivocado o id equivocado", () => {
    expect(
      extractPdsEndpoint({
        id: did,
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "http://pds.example.com" }],
      } as never)
    ).toBeNull();
    expect(
      extractPdsEndpoint({ id: did, service: [{ id: "#other", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://x" }] } as never)
    ).toBeNull();
    expect(extractPdsEndpoint({ id: did } as never)).toBeNull();
  });
});

describe("base58btcDecode / decodeMultibaseKey", () => {
  it("vector conocido: 'hello world'", () => {
    const decoded = base58btcDecode("StV1DL6CwTryKyV");
    expect(decoded).not.toBeNull();
    expect(new TextDecoder().decode(decoded!)).toBe("hello world");
  });

  it("prefijos '1' = bytes cero iniciales", () => {
    expect([...base58btcDecode("1")!]).toEqual([0]);
    expect([...base58btcDecode("111")!]).toEqual([0, 0, 0]);
  });

  it("caracter invalido o vacio -> null", () => {
    expect(base58btcDecode("0OIl")).toBeNull();
    expect(base58btcDecode("")).toBeNull();
  });

  it("Multikey ed25519 valida codec y longitud; basura -> null", () => {
    const good = ed25519Multibase(new Uint8Array(32).fill(1));
    expect(decodeMultibaseKey(good)?.codec).toBe("ed25519");
    expect(decodeMultibaseKey("zmNoEsBase58!")).toBeNull();
    expect(decodeMultibaseKey("nopenope")).toBeNull();
    // ed01 con longitud != 34 -> invalido
    const wrongLen = `z${base58Encode(new Uint8Array([0xed, 0x01, 1, 2, 3]))}`;
    expect(decodeMultibaseKey(wrongLen)).toBeNull();
  });
});

describe("parseDohTxtData", () => {
  it("concatena fragmentos entre comillas (mismo parser que dns-txt de apw-resolver)", () => {
    expect(parseDohTxtData('"parte1" "parte2"')).toBe("parte1parte2");
    expect(parseDohTxtData('"did=did:plc:abc"')).toBe("did=did:plc:abc");
    expect(parseDohTxtData("sin-comillas")).toBe("sin-comillas");
  });
});
