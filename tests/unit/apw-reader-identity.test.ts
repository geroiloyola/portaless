import { beforeEach, describe, expect, it } from "vitest";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import {
  resolveReaderState,
  readerHostFromOperator,
  ReaderStateCache,
  READER_CACHE_FAIL_MS,
  type ReaderResolvers,
} from "../../packages/apw-resolver/src/scoring/reader-identity";
import { evaluatePolicy, DEFAULT_GOVERNED_POLICY } from "../../packages/apw-resolver/src/scoring/policy";

const X = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";
const wba = {
  verified: true,
  agentKeyId: "kid",
  keyRecord: { operator: "https://indice.example", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: X } },
};

function resolvers(over: Partial<ReaderResolvers> = {}, calls = { n: 0 }): ReaderResolvers {
  return {
    resolveTxtKey: async () => {
      calls.n++;
      return jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: X } as JsonWebKey);
    },
    verifyHistory: async () => true,
    loadScores: async () => new Map(),
    ...over,
  };
}

let cache: ReaderStateCache;
beforeEach(() => {
  cache = new ReaderStateCache();
});

describe("readerHostFromOperator", () => {
  it("solo https, host en minusculas", () => {
    expect(readerHostFromOperator("https://Indice.Example")).toBe("indice.example");
    expect(readerHostFromOperator("http://indice.example")).toBeNull();
    expect(readerHostFromOperator("basura")).toBeNull();
  });
});

describe("resolveReaderState (6.3)", () => {
  it("sin firma valida -> anonymous (401)", async () => {
    expect(await resolveReaderState(null, resolvers(), cache)).toEqual({ kind: "anonymous" });
    const s = await resolveReaderState({ verified: false, reason: "signature_expired" }, resolvers(), cache);
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, s)).toMatchObject({ allow: false, status: "401" });
  });

  it("firma valida sin TXT APW -> wba_only", async () => {
    const s = await resolveReaderState(wba, resolvers({ resolveTxtKey: async () => null }), cache);
    expect(s.kind).toBe("wba_only");
  });

  it("clave que no es k del TXT -> apw_unresolvable (fail-closed)", async () => {
    const s = await resolveReaderState(wba, resolvers({ resolveTxtKey: async () => "z".repeat(43) }), cache);
    expect(s).toMatchObject({ kind: "apw_unresolvable", did: "did:apw:indice.example", reason: "key_not_bound_to_apw" });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, s)).toMatchObject({ allow: false, status: "403" });
  });

  it("historial que no verifica -> apw_unresolvable", async () => {
    const s = await resolveReaderState(wba, resolvers({ verifyHistory: async () => false }), cache);
    expect(s).toMatchObject({ kind: "apw_unresolvable", reason: "history_unverified" });
  });

  it("error de resolucion -> apw_unresolvable, nunca abre", async () => {
    const s = await resolveReaderState(wba, resolvers({ resolveTxtKey: async () => { throw new Error("dns"); } }), cache);
    expect(s).toMatchObject({ kind: "apw_unresolvable", reason: "resolution_error" });
  });

  it("clave = k e historial ok -> apw_verified con did del lector", async () => {
    const s = await resolveReaderState(wba, resolvers(), cache);
    expect(s).toMatchObject({ kind: "apw_verified", did: "did:apw:indice.example" });
  });

  it("cache: la segunda consulta no vuelve a resolver; los fallos expiran a los 60 s", async () => {
    const calls = { n: 0 };
    const r = resolvers({}, calls);
    await resolveReaderState(wba, r, cache, 0);
    await resolveReaderState(wba, r, cache, 1000);
    expect(calls.n).toBe(1);

    const failCalls = { n: 0 };
    const failing = resolvers({ verifyHistory: async () => false }, failCalls);
    const c2 = new ReaderStateCache();
    await resolveReaderState(wba, failing, c2, 0);
    await resolveReaderState(wba, failing, c2, READER_CACHE_FAIL_MS - 1);
    expect(failCalls.n).toBe(1);
    await resolveReaderState(wba, failing, c2, READER_CACHE_FAIL_MS + 1);
    expect(failCalls.n).toBe(2);
  });

  it("lector verificado sin reputacion no pasa la politica por defecto", async () => {
    const s = await resolveReaderState(wba, resolvers(), cache);
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, s)).toMatchObject({ allow: false, failed: ["R-01", "R-05"] });
  });
});
