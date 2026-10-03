import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../packages/apw-resolver/src/did-apw/sql-adapter";
import {
  SqlReadPolicyStore,
  InMemoryReadPolicyStore,
  READ_POLICY_DEFAULTS,
  INVALID_READ_POLICY,
  toReadPolicy,
} from "../../packages/apw-resolver/src/scoring/read-policy-store";
import { DEFAULT_GOVERNED_POLICY } from "../../packages/apw-resolver/src/scoring/policy";

const base = { siteId: "default", enabled: true, ...READ_POLICY_DEFAULTS, updatedBy: "admin" };

describe("site_trust_read_policies", () => {
  it("SQLite: sin fila no hay politica (lectura publica)", async () => {
    const store = new SqlReadPolicyStore(new SqliteAdapter(new Database(":memory:")));
    expect(await store.get("default")).toBeNull();
    expect(toReadPolicy(null)).toBeNull();
  });

  it("SQLite: guarda y lee; con todas las dimensiones activas equivale a la politica A.6", async () => {
    const store = new SqlReadPolicyStore(new SqliteAdapter(new Database(":memory:")));
    await store.save(base);
    const rec = await store.get("default");
    expect(rec).toMatchObject({ enabled: true, requireApwIdentity: true, minR01: 5, minR05: 5, onFail: "403" });
    expect(toReadPolicy(rec, { "R-01": true, "R-05": true })).toEqual(DEFAULT_GOVERNED_POLICY);
  });

  it("con la configuracion por defecto (E-9) exige R-01 y no R-05", async () => {
    const store = new InMemoryReadPolicyStore();
    const policy = toReadPolicy(await store.save(base));
    expect(policy?.require).toEqual({ identity: "apw_verified", "R-01": { min: 5, min_weight: 2 } });
  });

  it("SQLite: upsert y desactivar vuelve a lectura publica", async () => {
    const store = new SqlReadPolicyStore(new SqliteAdapter(new Database(":memory:")));
    await store.save(base);
    await store.save({ ...base, enabled: false, minR01: 6 });
    const rec = await store.get("default");
    expect(rec).toMatchObject({ enabled: false, minR01: 6 });
    expect(toReadPolicy(rec)).toBeNull();
  });

  it("rechaza valores fuera de rango", async () => {
    const store = new InMemoryReadPolicyStore();
    await expect(store.save({ ...base, minR01: 8 })).rejects.toThrow(INVALID_READ_POLICY);
    await expect(store.save({ ...base, minR05Weight: -1 })).rejects.toThrow(INVALID_READ_POLICY);
    await expect(store.save({ ...base, onFail: "500" as any })).rejects.toThrow(INVALID_READ_POLICY);
  });

  it("la base rechaza require_apw_identity = 0 (CHECK)", async () => {
    const db = new Database(":memory:");
    const store = new SqlReadPolicyStore(new SqliteAdapter(db));
    await store.get("default");
    expect(() =>
      db.prepare("INSERT INTO site_trust_read_policies (site_id, require_apw_identity, updated_at, updated_by) VALUES ('x', 0, 't', 'u')").run()
    ).toThrow();
  });
});
