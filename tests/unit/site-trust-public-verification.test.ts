// GET /trust/:siteId: metadatos aditivos de verificabilidad de las cuatro
// fuentes (APW B7 MVP). community queda marcada local_only, sin identidad
// criptografica ni prueba exportable; no se cambia el shape de los arrays.
// Desde B3 (ERRATA E-5), self es verificable si la fila trae attestationJws.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ snapshot: null as any }));
vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => ({ getSnapshot: async () => state.snapshot }),
}));

beforeEach(() => {
  state.snapshot = {
    siteId: "ejemplo.com",
    self: [{ category: "privacy_policy" }],
    agent: [{ category: "https_and_headers" }],
    community: [{ category: "content_accuracy", score: 4 }],
    escrowReports: [{ transactionOutcome: "completed_as_promised" }],
  };
});

describe("GET /trust/:siteId: verification metadata", () => {
  async function get(siteId = "ejemplo.com") {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    return onRequestGet({ env: {}, params: siteId ? { siteId } : {} });
  }

  it("conserva las cuatro fuentes y agrega metadatos aditivos", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.siteId).toBe("ejemplo.com");
    expect(body.self).toEqual(state.snapshot.self);
    expect(body.agent).toEqual(state.snapshot.agent);
    expect(body.community).toEqual(state.snapshot.community);
    expect(body.escrowReports).toEqual(state.snapshot.escrowReports);
    expect(body.verification).toMatchObject({
      self: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
      agent: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
      community: { status: "local_only", verifiable: false },
      escrow_report: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
    });
    expect(body.verification.community.reason).toContain("localStorage");
    expect(body.governance).toEqual({ enabled: false });
  });

  it("responde 400 sin siteId", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_site_id" });
  });
});
