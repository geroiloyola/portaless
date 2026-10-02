import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/stores/sqlite-site-trust-store.ts";
import { InMemorySiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/site-trust-score.ts";

const base = {
  siteId: "default",
  category: "privacy_policy" as const,
  declaredBy: "admin",
};

describe("self guarda su JWS junto a la fila (5.3)", () => {
  it("SQLite: escribe, lee y el upsert reemplaza la atestacion vigente", async () => {
    const store = new SqliteSiteTrustScoreStore(new Database(":memory:"));
    await store.recordSelfEvaluation({ ...base, declaredValue: true, declaredAt: "2026-10-02T00:00:00.000Z", attestationJws: "a.b.c", attestationJti: "j1" });
    let snap = await store.getSnapshot("default");
    expect(snap.self).toHaveLength(1);
    expect(snap.self[0]).toMatchObject({ declaredValue: true, attestationJws: "a.b.c", attestationJti: "j1" });

    await store.recordSelfEvaluation({ ...base, declaredValue: false, declaredAt: "2026-10-02T01:00:00.000Z", attestationJws: "d.e.f", attestationJti: "j2" });
    snap = await store.getSnapshot("default");
    expect(snap.self).toHaveLength(1);
    expect(snap.self[0]).toMatchObject({ declaredValue: false, attestationJws: "d.e.f", attestationJti: "j2" });
  });

  it("SQLite: sin identidad se guarda sin JWS", async () => {
    const store = new SqliteSiteTrustScoreStore(new Database(":memory:"));
    await store.recordSelfEvaluation({ ...base, declaredValue: true, declaredAt: "2026-10-02T00:00:00.000Z" });
    const snap = await store.getSnapshot("default");
    expect(snap.self[0].attestationJws).toBeUndefined();
    expect(snap.self[0].attestationJti).toBeUndefined();
  });

  it("SQLite: una base anterior (sin columnas) se migra sola", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE site_trust_self_evaluations (
      site_id TEXT NOT NULL, category TEXT NOT NULL, declared_value INTEGER NOT NULL,
      evidence_url TEXT, declared_by TEXT NOT NULL, declared_at TEXT NOT NULL,
      PRIMARY KEY (site_id, category))`);
    const store = new SqliteSiteTrustScoreStore(db);
    await store.recordSelfEvaluation({ ...base, declaredValue: true, declaredAt: "2026-10-02T00:00:00.000Z", attestationJws: "a.b.c", attestationJti: "j1" });
    const snap = await store.getSnapshot("default");
    expect(snap.self[0].attestationJws).toBe("a.b.c");
  });

  it("InMemory conserva el JWS", async () => {
    const store = new InMemorySiteTrustScoreStore();
    await store.recordSelfEvaluation({ ...base, declaredValue: true, declaredAt: "2026-10-02T00:00:00.000Z", attestationJws: "a.b.c", attestationJti: "j1" });
    const snap = await store.getSnapshot("default");
    expect(snap.self[0].attestationJws).toBe("a.b.c");
  });
});
