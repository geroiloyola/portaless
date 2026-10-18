import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyColumnMigrations } from "../../packages/persistence-migrations/src/runner";

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

// A.6 / ERRATA E-11: el dueno puede volver publica una dimension GOBERNADA
// (override explicito). Eso vive en public_overrides y viaja a
// projectTrustView(); no cambia la politica, cambia lo que se proyecta.
describe("public_overrides (A.6)", () => {
  it("guarda, normaliza y devuelve el override del dueno", async () => {
    const store = new SqlReadPolicyStore(new SqliteAdapter(new Database(":memory:")));
    const saved = await store.save({ ...base, publicOverrides: ["W-10", "W-02", "W-10"] });
    expect(saved.publicOverrides).toEqual(["W-02", "W-10"]);

    const rec = await store.get("default");
    expect(rec?.publicOverrides).toEqual(["W-02", "W-10"]);

    const mem = new InMemoryReadPolicyStore();
    const memRec = await mem.save({ ...base, publicOverrides: ["W-03"] });
    expect(memRec.publicOverrides).toEqual(["W-03"]);
    expect((await mem.get("default"))?.publicOverrides).toEqual(["W-03"]);
  });

  it("sin override guarda NULL y devuelve []", async () => {
    const db = new Database(":memory:");
    const store = new SqlReadPolicyStore(new SqliteAdapter(db));
    await store.save(base);
    const raw = db.prepare("SELECT public_overrides FROM site_trust_read_policies WHERE site_id = ?").get("default") as {
      public_overrides: string | null;
    };
    expect(raw.public_overrides).toBeNull();
    expect((await store.get("default"))?.publicOverrides).toEqual([]);
  });

  it("solo dimensiones GOBERNADAS: el nivel publico no se puede 'abrir' ni inventar", async () => {
    const store = new InMemoryReadPolicyStore();
    await expect(store.save({ ...base, publicOverrides: ["W-01"] })).rejects.toThrow(INVALID_READ_POLICY); // ya es publica
    await expect(store.save({ ...base, publicOverrides: ["X-9"] })).rejects.toThrow(INVALID_READ_POLICY); // desconocida
    await expect(store.save({ ...base, publicOverrides: ["R-01"] })).resolves.toMatchObject({ publicOverrides: ["R-01"] });
  });

  it("una fila corrupta no tumba la lectura: se ignora y el dueno queda sin override", async () => {
    const db = new Database(":memory:");
    const store = new SqlReadPolicyStore(new SqliteAdapter(db));
    await store.save({ ...base, publicOverrides: ["W-10"] });
    db.prepare("UPDATE site_trust_read_policies SET public_overrides = ? WHERE site_id = ?").run("{esto no es json", "default");
    expect((await store.get("default"))?.publicOverrides).toEqual([]);
  });

  it("migra sola una base creada antes de la columna", async () => {
    const db = new Database(":memory:");
    db.prepare(
      `CREATE TABLE site_trust_read_policies (
        site_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        require_apw_identity INTEGER NOT NULL DEFAULT 1 CHECK (require_apw_identity = 1),
        min_r01 REAL NOT NULL DEFAULT 5.0 CHECK (min_r01 >= 1 AND min_r01 <= 7),
        min_r01_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r01_weight >= 0),
        min_r05 REAL NOT NULL DEFAULT 5.0 CHECK (min_r05 >= 1 AND min_r05 <= 7),
        min_r05_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r05_weight >= 0),
        on_fail TEXT NOT NULL DEFAULT '403' CHECK (on_fail IN ('401', '402', '403')),
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      )`
    ).run();
    db.prepare("INSERT INTO site_trust_read_policies (site_id, enabled, updated_at, updated_by) VALUES ('default', 1, 't', 'admin')").run();
    applyColumnMigrations(db); // columnas de las migraciones numeradas (base vieja)

    const store = new SqlReadPolicyStore(new SqliteAdapter(db));
    const rec = await store.get("default");
    expect(rec).toMatchObject({ enabled: true, minR01: 5, publicOverrides: [] });

    await store.save({ ...base, publicOverrides: ["W-10"] });
    expect((await store.get("default"))?.publicOverrides).toEqual(["W-10"]);
  });
});
