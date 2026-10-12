// packages/identity-atproto/src/reputation.ts: el join "simbiotico" del
// puente APW <-> AT. Todas las dependencias se inyectan (sin red real):
// resolucion AT, resolucion APW por candidato, snapshot de confianza del
// sitio y atestaciones reader_conduct. Cubre: sintaxis/TPD reservados sin
// tocar dependencias, fallo de resolucion + cache, join completo con las
// tres confianzas (also_known_as / subdomain / self), degradacion honesta
// (sin APW, trust caido, conduct sin historial), y el default
// fetchSiteTrust: remoto 200 con recalculo de proyeccion publica, 403
// gobernado con public embebido, fetch que tira, y camino local (identidad
// did:apw:<siteId> en esta misma instancia, sin fetch).

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { applySchema } from "../../scripts/setup.mjs";
import {
  buildAtprotoReputation,
  __clearAtprotoReputationCacheForTests,
  type AtprotoReputationDeps,
} from "../../packages/identity-atproto/src/reputation";

const tmp = mkdtempSync(join(tmpdir(), "portaless-atproto-reputation-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const HANDLE = "username.wikipedia.org";
const SITE = "wikipedia.org";
const SITE_DID = "did:apw:wikipedia.org";

function okIdentity(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    identity: {
      handle: HANDLE,
      did: "did:plc:abc123",
      didMethod: "plc" as const,
      resolvedBy: "txt" as const,
      document: { id: "did:plc:abc123", alsoKnownAs: [`at://${HANDLE}`] },
      claimedHandles: [HANDLE],
      signingKey: { id: "did:plc:abc123#key", type: "Multikey", multibase: "z6Mk" },
      pds: "https://pds.example.com",
      ...overrides,
    },
  };
}

const attestation = {
  id: "att-1",
  iss: "did:apw:otro.example",
  sub: `did:apw:${HANDLE}`,
  src: "reader_conduct" as const,
  dimension: "R-01",
  value: 6,
};

function deps(overrides: Partial<AtprotoReputationDeps> = {}): AtprotoReputationDeps {
  return {
    resolveAtproto: vi.fn(async () => okIdentity()),
    resolveApwSite: vi.fn(async (domain: string) => ({
      verified: false,
      reason: "no_valid_manifest_found" as const,
      domain,
    })),
    fetchSiteTrust: vi.fn(async () => null),
    loadConduct: vi.fn(async () => ({
      ok: false as const,
      reason: "reader_conduct_history_unverified" as const,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  __clearAtprotoReputationCacheForTests();
});

describe("validacion inicial (sin tocar ninguna dependencia)", () => {
  it("handle con sintaxis invalida -> resolved false / invalid_handle", async () => {
    const d = deps();
    const result = await buildAtprotoReputation("nope", d);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("invalid_handle");
    expect(result.apw).toBeNull();
    expect(result.user).toBeNull();
    expect(result.limitations).toHaveLength(4);
    expect(d.resolveAtproto).not.toHaveBeenCalled();
    expect(d.resolveApwSite).not.toHaveBeenCalled();
    expect(d.loadConduct).not.toHaveBeenCalled();
  });

  it("TLD reservado (.test) -> reserved_tld", async () => {
    const d = deps();
    expect((await buildAtprotoReputation("user.test", d)).reason).toBe("reserved_tld");
    expect(d.resolveAtproto).not.toHaveBeenCalled();
  });
});

describe("resolucion AT fallida", () => {
  it("propaga el motivo y cachea el fallo (1 min): la segunda llamada no re-resuelve", async () => {
    const d = deps({
      resolveAtproto: vi.fn(async () => ({ ok: false as const, reason: "handle_unresolvable" as const })),
    });

    const first = await buildAtprotoReputation(HANDLE, d);
    expect(first).toMatchObject({ handle: HANDLE, resolved: false, reason: "handle_unresolvable", apw: null, user: null });

    const second = await buildAtprotoReputation(HANDLE, d);
    expect(second.reason).toBe("handle_unresolvable");
    expect(d.resolveAtproto).toHaveBeenCalledTimes(1);
    expect(d.resolveApwSite).not.toHaveBeenCalled();
  });
});

describe("join completo (confianza also_known_as)", () => {
  const trustView = {
    siteId: SITE,
    counts: { self: 3, agent: 1, community: 0, escrowReports: 0 },
    projection: { aggregates: {}, dimensions: {}, governed: "withheld" as const },
    trustUrl: `https://${SITE}/trust/${SITE}`,
  };

  it("identidad AT + sitio APW con trust + usuario con atestaciones", async () => {
    const d = deps({
      resolveApwSite: vi.fn(async (domain: string) =>
        domain === SITE
          ? {
              verified: true,
              reason: "ok" as const,
              domain,
              did: SITE_DID,
              didDocument: { id: SITE_DID, alsoKnownAs: [`at://${HANDLE}`] },
            }
          : { verified: false, reason: "no_valid_manifest_found" as const, domain }
      ),
      fetchSiteTrust: vi.fn(async () => trustView),
      loadConduct: vi.fn(async () => ({
        ok: true as const,
        attestations: [attestation],
        checkedEntries: 1,
        ignoredLegacy: 0,
      })),
    });

    const result = await buildAtprotoReputation(HANDLE, d);

    expect(result.resolved).toBe(true);
    expect(result.identity).toMatchObject({
      did: "did:plc:abc123",
      didMethod: "plc",
      resolvedBy: "txt",
      claimedHandles: [HANDLE],
      hasSigningKey: true,
      pds: "https://pds.example.com",
    });

    expect(result.apw).toEqual({
      siteId: SITE,
      confidence: "also_known_as",
      did: SITE_DID,
      trust: trustView,
    });
    expect(result.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(false);

    // usuario: subjectDid host-scoped + dimensiones R (R-01 puntuada y R-05 neutral)
    expect(result.user).toMatchObject({ status: "ok", subjectDid: `did:apw:${HANDLE}` });
    const dims = (result.user as { status: "ok"; dimensions: { dimension: string; score: number }[] }).dimensions;
    expect(dims.map((d2) => d2.dimension)).toEqual(["R-01", "R-05"]);
    expect(dims[0].score).toBeGreaterThanOrEqual(1);
    expect(dims[0].score).toBeLessThanOrEqual(7);

    // cache OK: la segunda llamada reutiliza (resolveAtproto una sola vez)
    await buildAtprotoReputation(HANDLE, d);
    expect(d.resolveAtproto).toHaveBeenCalledTimes(1);
    expect(d.fetchSiteTrust).toHaveBeenCalledTimes(1);
  });

  it("confianza subdomain si el candidato no reclama el handle explicitamente", async () => {
    const d = deps({
      resolveApwSite: vi.fn(async (domain: string) =>
        domain === SITE
          ? { verified: true, reason: "ok" as const, domain, did: SITE_DID, didDocument: { id: SITE_DID } }
          : { verified: false, reason: "no_valid_manifest_found" as const, domain }
      ),
      fetchSiteTrust: vi.fn(async () => trustView),
    });

    const result = await buildAtprotoReputation(HANDLE, d);
    expect(result.apw).toMatchObject({ siteId: SITE, confidence: "subdomain", trust: trustView });
  });

  it("confianza self si el handle ES el dominio del sitio", async () => {
    const d = deps({
      resolveAtproto: vi.fn(async () => okIdentity({ handle: SITE })),
      resolveApwSite: vi.fn(async (domain: string) =>
        domain === SITE
          ? { verified: true, reason: "ok" as const, domain, did: SITE_DID, didDocument: { id: SITE_DID } }
          : { verified: false, reason: "no_valid_manifest_found" as const, domain }
      ),
      fetchSiteTrust: vi.fn(async () => trustView),
    });

    const result = await buildAtprotoReputation(SITE, d);
    expect(result.apw).toMatchObject({ siteId: SITE, confidence: "self" });
  });
});

describe("degradacion honesta", () => {
  it("sin candidato APW verificado -> apw null, identity y user siguen", async () => {
    const d = deps({
      loadConduct: vi.fn(async () => ({
        ok: true as const,
        attestations: [attestation],
        checkedEntries: 1,
        ignoredLegacy: 0,
      })),
    });
    const result = await buildAtprotoReputation(HANDLE, d);
    expect(result.apw).toBeNull();
    expect(result.identity?.did).toBe("did:plc:abc123");
    expect(result.user?.status).toBe("ok");
    expect(d.resolveApwSite).toHaveBeenCalledTimes(2); // username.wikipedia.org y wikipedia.org
  });

  it("trust que devuelve null o tira -> trust null + limitation site_trust_unreachable", async () => {
    const linkDeps = {
      resolveApwSite: vi.fn(async (domain: string) =>
        domain === SITE
          ? { verified: true, reason: "ok" as const, domain, did: SITE_DID, didDocument: { id: SITE_DID } }
          : { verified: false, reason: "no_valid_manifest_found" as const, domain }
      ),
    };

    const nulo = await buildAtprotoReputation(HANDLE, deps({ ...linkDeps, fetchSiteTrust: vi.fn(async () => null) }));
    expect(nulo.apw?.trust).toBeNull();
    expect(nulo.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(true);

    __clearAtprotoReputationCacheForTests();
    const tira = await buildAtprotoReputation(
      HANDLE,
      deps({ ...linkDeps, fetchSiteTrust: vi.fn(async () => { throw new Error("boom"); }) })
    );
    expect(tira.apw?.trust).toBeNull();
    expect(tira.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(true);
  });

  it("conduct sin historial -> no_data con motivo; conduct que tira -> reader_conduct_unreachable", async () => {
    const sinHistorial = await buildAtprotoReputation(HANDLE, deps());
    expect(sinHistorial.user).toEqual({ status: "no_data", reason: "reader_conduct_history_unverified" });

    __clearAtprotoReputationCacheForTests();
    const tira = await buildAtprotoReputation(
      HANDLE,
      deps({ loadConduct: vi.fn(async () => { throw new Error("history caido"); }) })
    );
    expect(tira.user).toEqual({ status: "no_data", reason: "reader_conduct_unreachable" });
  });
});

describe("default fetchSiteTrust (no inyectado)", () => {
  const linkDeps = () => ({
    // explicito: anula el fetchSiteTrust por defecto de deps() para que
    // corra el defaultFetchSiteTrust real (local-vs-remoto).
    fetchSiteTrust: undefined,
    resolveApwSite: vi.fn(async (domain: string) =>
      domain === SITE
        ? { verified: true, reason: "ok" as const, domain, did: SITE_DID, didDocument: { id: SITE_DID } }
        : { verified: false, reason: "no_valid_manifest_found" as const, domain }
    ),
    loadConduct: vi.fn(async () => ({ ok: false as const, reason: "reader_conduct_history_unverified" as const })),
  });

  it("remoto 200 con snapshot completo -> recalcula la proyeccion SOLO publica", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          siteId: SITE,
          self: [{ category: "privacy_policy", declaredValue: true }],
          agent: [],
          community: [],
          escrowReports: [],
        })
      )
    );
    const result = await buildAtprotoReputation(HANDLE, deps({ ...linkDeps(), fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://${SITE}/trust/${SITE}`,
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(result.apw?.trust?.counts).toEqual({ self: 1, agent: 0, community: 0, escrowReports: 0 });
    expect(result.apw?.trust?.projection?.governed).toBe("withheld");
    expect(Object.keys(result.apw?.trust?.projection?.dimensions ?? {})).toEqual(["W-04"]);
  });

  it("remoto 403 gobernado -> usa public embebido sin recalcular", async () => {
    const publicView = { aggregates: {}, dimensions: {}, governed: "withheld" as const };
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ public: { counts: { self: 7 }, projection: publicView } }), { status: 403 })
    );
    const result = await buildAtprotoReputation(HANDLE, deps({ ...linkDeps(), fetchImpl }));

    expect(result.apw?.trust).toEqual({
      siteId: SITE,
      counts: { self: 7 },
      projection: publicView,
      trustUrl: `https://${SITE}/trust/${SITE}`,
    });
    expect(result.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(false);
  });

  it("remoto con fetch que tira -> trust null + limitation", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("red caida"); });
    const result = await buildAtprotoReputation(HANDLE, deps({ ...linkDeps(), fetchImpl }));
    expect(result.apw?.trust).toBeNull();
    expect(result.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(true);
  });

  it("local: identidad did:apw:<siteId> en esta instancia -> lee el store sin fetch", async () => {
    const file = join(tmp, `local-${Math.random().toString(36).slice(2)}.db`);
    await applySchema(file, { quiet: true });
    const env = {
      PORTALESS_SQLITE_PATH: file,
      PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: Buffer.from(randomBytes(32)).toString("base64"),
    };

    const { generateApwDid } = await import("../../packages/apw-resolver/src/did-apw/generate");
    const { createSiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/store-factory");
    const keyPair = await generateApwDid(SITE);
    expect(keyPair.did).toBe(SITE_DID);
    await (await createSiteIdentityStore(env)).create("default", keyPair, "test");

    const fetchImpl = vi.fn(async () => { throw new Error("no deberia haber fetch en el camino local"); });
    const result = await buildAtprotoReputation(HANDLE, deps({ ...linkDeps(), env, fetchImpl }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.apw?.trust).toMatchObject({
      siteId: SITE,
      counts: { self: 0, agent: 0, community: 0, escrowReports: 0 },
      trustUrl: `https://${SITE}/trust/${SITE}`,
    });
    expect(result.apw?.trust?.projection?.governed).toBe("withheld");
    expect(result.limitations.some((l) => l.startsWith("site_trust_unreachable"))).toBe(false);
  });
});
