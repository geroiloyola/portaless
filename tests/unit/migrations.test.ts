// Contrato de datos: migraciones numeradas (packages/persistence-migrations).
// Pure logic (version/pending/fail-closed) + runner SQLite real (backup,
// transaccion, idempotencia, dry-run). Sin DB externa: archivo temporal.
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MIGRATIONS,
  SchemaNewerThanCodeError,
  assertCompatible,
  pendingFrom,
  schemaVersion,
} from "../../packages/persistence-migrations/src/index";
import { currentVersion, migrateSqlite } from "../../packages/persistence-migrations/src/runner";
import { openSqlite } from "../../packages/sqlite-driver/src/open";
import { applySchema } from "../../scripts/setup.mjs";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-mig-"));
  cleanup.push(dir);
  return join(dir, "portaless.db");
}

describe("migraciones: logica pura", () => {
  it("el baseline es v1 y schemaVersion es el maximo", () => {
    expect(MIGRATIONS[0]).toMatchObject({ version: 1, name: "baseline" });
    expect(schemaVersion()).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
  });

  it("pendingFrom devuelve solo lo que falta, ordenado", () => {
    expect(pendingFrom(schemaVersion())).toEqual([]);
    expect(pendingFrom(0).map((m) => m.version)).toEqual([...MIGRATIONS].map((m) => m.version).sort((a, b) => a - b));
  });

  it("assertCompatible: una base mas nueva que el codigo es fail-closed", () => {
    expect(() => assertCompatible(schemaVersion())).not.toThrow();
    expect(() => assertCompatible(schemaVersion() + 1)).toThrow(SchemaNewerThanCodeError);
  });
});

describe("migraciones: runner SQLite", () => {
  it("base inexistente: no hace nada (schema.sql la crea al arrancar)", async () => {
    const result = await migrateSqlite(tempDb());
    expect(result).toMatchObject({ from: 0, to: 0, applied: [] });
  });

  it("applySchema estampa las migraciones hasta la version del codigo", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true }); // schema.sql es la forma ACTUAL
    const db = await openSqlite(path);
    expect(currentVersion(db)).toBe(schemaVersion());
    db.close();
    // Y no queda nada pendiente.
    const result = await migrateSqlite(path);
    expect(result.applied).toEqual([]);
    expect(result.from).toBe(schemaVersion());
  });

  it("idempotente: re-ejecutar no aplica nada", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    await migrateSqlite(path);
    const again = await migrateSqlite(path);
    expect(again.applied).toEqual([]);
    expect(again.from).toBe(schemaVersion());
  });

  it("--dry-run no toca la base ni hace backup", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const pre = await openSqlite(path);
    pre.exec("DROP TABLE schema_migrations"); // base vieja
    pre.close();
    const dry = await migrateSqlite(path, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.applied.length).toBeGreaterThan(0);
    expect(dry.backupPath).toBeNull();
    const db = await openSqlite(path);
    expect(currentVersion(db)).toBe(0); // el dry-run NO estampo
    db.close();
  });

  it("fail-closed: una base mas nueva que el codigo NO migra", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      schemaVersion() + 5,
      "future",
      new Date().toISOString(),
    );
    db.close();
    await expect(migrateSqlite(path)).rejects.toThrow(SchemaNewerThanCodeError);
  });

  it("backup antes de migrar: deja un archivo en <dir>/backups", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    // Simular una base VIEJA: dejar registrada solo la v1 (el resto es delta).
    const pre = await openSqlite(path);
    pre.prepare("DELETE FROM schema_migrations WHERE version > 1").run();
    pre.close();
    const result = await migrateSqlite(path);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.backupPath).toBeTruthy();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readdirSync(join(resolve(path, ".."), "backups")).length).toBeGreaterThan(0);
  });
});

// --- v2/v3: consolidacion de los ALTER TABLE dispersos + gate de migraciones ---
import { applyColumnMigrations } from "../../packages/persistence-migrations/src/runner";
import { migrationStatus } from "../../packages/persistence-migrations/src/gate";
import Database from "better-sqlite3";

describe("migraciones v2/v3: columnas historicas consolidadas", () => {
  it("v2/v3 declaran las columnas que antes vivian dispersas en los stores", () => {
    const cols = MIGRATIONS.flatMap((m) => m.addColumns ?? []);
    const has = (t: string, c: string) => cols.some((x) => x.table === t && x.column === c);
    for (const [t, c] of [
      ["site_identity_keys", "key_id"], ["site_identity_keys", "key_sequence"],
      ["site_attestation_log", "att_jws"], ["site_trust_self_evaluations", "attestation_jws"],
      ["site_trust_read_policies", "public_overrides"], ["usage_ledger", "reader_did"],
      ["authorized_escrow_providers", "public_key_jwk"],
      ["users", "email"], ["users", "oauth_subject"], ["plugin_artifacts", "manifest_json"],
    ] as const) expect(has(t, c), `${t}.${c}`).toBe(true);
  });

  it("applyColumnMigrations agrega columnas a una tabla vieja y es idempotente", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT, role TEXT, created_at TEXT)");
    db.prepare("INSERT INTO users VALUES ('a','h','admin','t')").run();
    applyColumnMigrations(db);
    applyColumnMigrations(db); // no revienta
    const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map((r: any) => r.name);
    expect(cols).toContain("email");
    expect(cols).toContain("oauth_subject");
    expect(db.prepare("SELECT username FROM users").get()).toMatchObject({ username: "a" });
    db.close();
  });

  it("migrateSqlite agrega las columnas de v2/v3 a una base pre-versionada", async () => {
    const path = tempDb();
    const db = new Database(path);
    db.exec("CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT, role TEXT, created_at TEXT)");
    db.prepare("INSERT INTO users VALUES ('legacy','h','admin','t')").run();
    db.close();
    const result = await migrateSqlite(path);
    expect(result.to).toBe(schemaVersion());
    const check = new Database(path);
    expect(check.prepare("SELECT name FROM pragma_table_info('users')").all().map((r: any) => r.name)).toContain("email");
    expect(check.prepare("SELECT username FROM users").get()).toMatchObject({ username: "legacy" });
    check.close();
  });
});

describe("gate de migraciones", () => {
  it("sin base -> null (hosting estatico, no hay gate)", async () => {
    expect(await migrationStatus({})).toBeNull();
  });

  it("base al dia -> pending=false, newer=false", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    await migrateSqlite(path);
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status).toMatchObject({ pending: false, newer: false, codeVersion: schemaVersion() });
  });

  it("base pre-versionada -> pending=true (el middleware responde 503)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("DROP TABLE schema_migrations"); // base vieja sin libro mayor
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status?.pending).toBe(true);
  });

  it("base mas nueva que el codigo -> newer=true (fail-closed)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(schemaVersion() + 9, "future", "t");
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status?.newer).toBe(true);
  });
});

// v4: el sprint de email:send agrega su tabla por el estandar de migraciones
// (no por ALTER manual ni solo por schema.sql), asi queda en el libro mayor.
describe("migracion v4: capacidad email:send", () => {
  it("declara plugin_email_quota (el rate limit vive en la base)", () => {
    const v4 = MIGRATIONS.find((m) => m.version === 4);
    expect(v4).toMatchObject({ version: 4, name: "email_capabilities" });
    expect(v4!.statements.join("\n")).toContain("plugin_email_quota");
  });

  it("migrateSqlite en una base v3 crea plugin_email_quota (idempotente)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("DROP TABLE IF EXISTS plugin_email_quota");
    db.prepare("DELETE FROM schema_migrations WHERE version >= 4").run();
    db.close();
    const result = await migrateSqlite(path);
    expect(result.applied).toContain("email_capabilities");
    const check = await openSqlite(path);
    expect(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_email_quota'").get(),
    ).toBeTruthy();
    check.close();
  });
});
