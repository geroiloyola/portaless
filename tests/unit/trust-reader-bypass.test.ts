// GET /trust/:siteId con politica de lectura activa (6.5): el grant
// trust:read-governance-bypass del Centro de Permisos deja pasar al lector
// con DID verificado aunque no cumpla los umbrales. Sin el grant, o con un
// lector cuya identidad no se pudo comprobar, manda la politica (on_fail).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: null as any,
  reader: null as any,
  permissionGrants: [] as any[],
  grantsStoreBroken: false,
  policyEnabled: true,
}));

vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => ({ getSnapshot: async () => state.snapshot }),
}));

vi.mock("../../packages/apw-resolver/src/scoring/read-policy-store.ts", () => ({
  createReadPolicyStore: async () => ({
    get: async () => ({
      siteId: "default",
      enabled: state.policyEnabled,
      requireApwIdentity: true,
      minR01: 5,
      minR01Weight: 2,
      minR05: 5,
      minR05Weight: 2,
      onFail: "403",
      updatedAt: "t",
      updatedBy: "admin",
    }),
  }),
  toReadPolicy: (record: any) =>
    record && record.enabled
      ? {
          resource: "/trust/*",
          action: "read",
          require: { identity: "apw_verified", "R-01": { min: record.minR01, min_weight: record.minR01Weight } },
          on_fail: record.onFail,
        }
      : null,
}));

vi.mock("../../packages/apw-resolver/src/scoring/reader-identity.ts", () => ({
  resolveReaderState: async () => state.reader,
  defaultReaderResolvers: () => ({}),
}));

vi.mock("../../packages/permissions/src/store-factory.ts", () => ({
  createPermissionStore: async () => {
    if (state.grantsStoreBroken) throw new Error("permission store down");
    return {
      getGrantsFor: async (subject: any) =>
        state.permissionGrants.filter((g) => g.subject.type === subject.type && g.subject.id === subject.id),
      setGrant: async () => {},
      getAllGrants: async () => state.permissionGrants,
    };
  },
}));

const DID = "did:apw:indice.example";
const READER_SUBJECT = { type: "reader", id: DID, displayName: DID };

beforeEach(() => {
  state.snapshot = {
    siteId: "ejemplo.com",
    self: [],
    agent: [],
    community: [],
    escrowReports: [],
  };
  // Lector verificado pero sin reputacion: los umbrales lo rechazan.
  state.reader = { kind: "apw_verified", did: DID, scores: new Map() };
  state.permissionGrants = [];
  state.grantsStoreBroken = false;
  state.policyEnabled = true;
});

async function get() {
  const { onRequestGet } = await import("../../functions/trust/[siteId].js");
  return onRequestGet({ env: {}, params: { siteId: "ejemplo.com" }, request: {}, data: { webBotAuth: { verified: true } } });
}

describe("GET /trust/:siteId: excepcion por lector (6.5)", () => {
  it("sin grant, el lector verificado sin reputacion queda rechazado con lo publico", async () => {
    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "read_governed",
      reason: "reputation_insufficient",
      failed: ["R-01"],
      governance: { enabled: true, granted: false },
    });
    expect(body.public.verification.community.status).toBe("mixed_per_entry");
  });

  it("con grant activo sobre su DID, lee aunque no cumpla umbrales", async () => {
    state.permissionGrants = [
      { subject: READER_SUBJECT, capabilityId: "trust:read-governance-bypass", granted: true },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.siteId).toBe("ejemplo.com");
    expect(body.governance).toEqual({ enabled: true, granted: true, bypass: true, reader: DID });
  });

  it("con el grant revocado, vuelve a la politica", async () => {
    state.permissionGrants = [
      { subject: READER_SUBJECT, capabilityId: "trust:read-governance-bypass", granted: false },
    ];
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).governance).toEqual({ enabled: true, granted: false });
  });

  it("un grant sobre otro DID no exime a este lector", async () => {
    state.permissionGrants = [
      {
        subject: { type: "reader", id: "did:apw:otro.example", displayName: "did:apw:otro.example" },
        capabilityId: "trust:read-governance-bypass",
        granted: true,
      },
    ];
    expect((await get()).status).toBe(403);
  });

  it("un grant de plugin con la misma capacidad no exime a nadie", async () => {
    state.permissionGrants = [
      {
        subject: { type: "plugin", id: "commerce-plugin", displayName: "Commerce" },
        capabilityId: "trust:read-governance-bypass",
        granted: true,
      },
    ];
    expect((await get()).status).toBe(403);
  });

  it("si el Centro de Permisos no se puede leer, no hay bypass: se aplica la politica", async () => {
    state.grantsStoreBroken = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await get()).status).toBe(403);
    warn.mockRestore();
  });

  it("el bypass no salta la identidad: apw_unresolvable queda en on_fail aunque haya grant", async () => {
    state.reader = { kind: "apw_unresolvable", did: DID, reason: "reader_conduct_incomplete" };
    state.permissionGrants = [
      { subject: READER_SUBJECT, capabilityId: "trust:read-governance-bypass", granted: true },
    ];
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("history_unresolvable");
  });

  it("sin politica activa el bypass es irrelevante (lectura publica)", async () => {
    state.policyEnabled = false;
    state.permissionGrants = [
      { subject: READER_SUBJECT, capabilityId: "trust:read-governance-bypass", granted: true },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).governance).toEqual({ enabled: false });
  });
});
