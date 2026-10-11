// GET /trust/:siteId (6.6 / A.6): la proyeccion de dimensiones W viaja
// siempre. Al rechazar, `public.projection.dimensions` solo trae el conjunto
// publico (W-01, W-04, W-06, W-07, W-09) y `aggregates` el puntaje, la
// cantidad y la suma de pesos de TODAS las dimensiones del sitio. Al permitir,
// las dimensiones gobernadas tambien entran (`governed: "granted"`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_DIMENSIONS } from "../../packages/apw-resolver/src/scoring/policy";

const state = vi.hoisted(() => ({
  snapshot: null as any,
  reader: null as any,
  permissionGrants: [] as any[],
  policyEnabled: true,
}));

vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => ({ getSnapshot: async () => state.snapshot }),
}));

vi.mock("../../packages/apw-resolver/src/scoring/read-policy-store.ts", () => ({
  createReadPolicyStore: async () => ({
    get: async () => ({ siteId: "default", enabled: state.policyEnabled, onFail: "403" }),
  }),
  toReadPolicy: (record: any) =>
    record && record.enabled
      ? {
          resource: "/trust/*",
          action: "read",
          require: { identity: "apw_verified", "R-01": { min: 5, min_weight: 2 } },
          on_fail: record.onFail,
        }
      : null,
}));

vi.mock("../../packages/apw-resolver/src/scoring/reader-identity.ts", () => ({
  resolveReaderState: async () => state.reader,
  defaultReaderResolvers: () => ({}),
}));

vi.mock("../../packages/permissions/src/store-factory.ts", () => ({
  createPermissionStore: async () => ({
    getGrantsFor: async (subject: any) =>
      state.permissionGrants.filter((g) => g.subject.type === subject.type && g.subject.id === subject.id),
    setGrant: async () => {},
    getAllGrants: async () => state.permissionGrants,
  }),
}));

const DID = "did:apw:indice.example";
const READER_SUBJECT = { type: "reader", id: DID, displayName: DID };

beforeEach(() => {
  state.snapshot = {
    siteId: "ejemplo.com",
    self: [
      { category: "gdpr_compliance", declaredValue: true },
      { category: "terms_of_service", declaredValue: true },
      { category: "payment_security", declaredValue: true },
    ],
    agent: [
      { category: "https_and_headers", verified: true, agentKeyId: "https://ag.example", verifiedAt: "t" },
      { category: "content_freshness", verified: false, agentKeyId: "https://ag.example", verifiedAt: "t" },
      { category: "structured_data_quality", verified: true, agentKeyId: "https://ag.example", verifiedAt: "t" },
    ],
    community: [
      { category: "spam_or_deceptive", score: 5, voterId: "v1", votedAt: "t" },
      { category: "responsiveness", score: 4, voterId: "v1", votedAt: "t" },
      { category: "content_accuracy", score: 3, voterId: "v2", votedAt: "t" },
    ],
    escrowReports: [{ transactionOutcome: "completed_as_promised", escrowProvider: "p1", reportedAt: "t" }],
  };
  state.reader = { kind: "apw_verified", did: DID, scores: new Map() };
  state.permissionGrants = [];
  state.policyEnabled = true;
});

async function get() {
  const { onRequestGet } = await import("../../functions/trust/[siteId].js");
  return onRequestGet({ env: {}, params: { siteId: "ejemplo.com" }, request: {}, data: { webBotAuth: { verified: true } } });
}

describe("GET /trust/:siteId: proyeccion de dimensiones W (6.6)", () => {
  it("al rechazar, el nivel publico incluye las dimensiones publicas y los agregados de todas", async () => {
    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    const { projection } = body.public;

    expect(projection.governed).toBe("withheld");
    expect(Object.keys(projection.dimensions).sort()).toEqual([...PUBLIC_DIMENSIONS].sort());
    // W-02 (content_accuracy) y W-10 (spam) tienen filas: aparecen solo en agregados.
    expect(Object.keys(projection.aggregates).sort()).toEqual(
      ["W-01", "W-02", "W-03", "W-04", "W-05", "W-06", "W-07", "W-09", "W-10"].sort()
    );
    expect(projection.dimensions["W-10"]).toBeUndefined();
    expect(projection.dimensions["W-02"]).toBeUndefined();
    expect(projection.aggregates["W-10"]).toMatchObject({ score: expect.any(Number), count: 1 });
    expect(projection.aggregates["W-10"].weightSum).toBeGreaterThan(0);

    // El nivel publico nunca se oculta: cada dimension publica con datos esta.
    for (const d of PUBLIC_DIMENSIONS) {
      expect(projection.dimensions[d]).toMatchObject({ dimension: d, score: expect.any(Number) });
    }
    expect(body.public.verification).toBeDefined();
    expect(body.public.counts.agent).toBe(3);
    expect(body.projection).toBeUndefined();
  });

  it("al permitir (grant), las dimensiones gobernadas entran y governed es granted", async () => {
    state.permissionGrants = [
      { subject: READER_SUBJECT, capabilityId: "trust:read-governance-bypass", granted: true },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const { projection } = await res.json();

    expect(projection.governed).toBe("granted");
    expect(Object.keys(projection.dimensions).sort()).toEqual(Object.keys(projection.aggregates).sort());
    expect(projection.dimensions["W-10"]).toBeDefined();
    expect(projection.dimensions["W-02"]).toBeDefined();
    expect(projection.dimensions["W-05"]).toBeDefined();
    expect(projection.dimensions["R-01"]).toBeUndefined();
  });

  it("sin politica activa la proyeccion tambien es publica completa", async () => {
    state.policyEnabled = false;
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.projection.governed).toBe("granted");
    expect(Object.keys(body.projection.dimensions).sort()).toEqual(Object.keys(body.projection.aggregates).sort());
    expect(body.governance).toEqual({ enabled: false });
    expect(body.self).toEqual(state.snapshot.self);
  });
});
