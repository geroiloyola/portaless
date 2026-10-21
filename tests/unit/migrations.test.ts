// Contrato de datos: migraciones numeradas (packages/persistence-migrations).
// Pure logic (version/pending/fail-closed) + runner SQLite real (backup,
// transaccion, idempotencia, dry-run). Sin DB externa: archivo temporal.
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MIGRATIONS,
  SchemaNewerThanCodeError,
  assertCompatible,
  pendingFrom,
  schemaVersion,
} from "../../packages/persistence-migrations/src/index";
import { PLUGIN_EMAIL_QUOTA_DDL } from "../../packages/persistence-migrations/src/ddl";
import { MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_NO_DELETE_DDL, MCP_AUDIT_TABLE_DDL } from "../../packages/persistence-migrations/src/ddl";
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

async function makeHistoricalDb(path: string, version: number): Promise<void> {
  await applySchema(path, { quiet: true });
  const db = new Database(path);
  try {
    db.exec("DROP INDEX IF EXISTS idx_users_oauth");
    db.exec("DROP INDEX IF EXISTS idx_site_identity_keys_seq");
    db.exec("DROP INDEX IF EXISTS idx_site_trust_agent_jti");
    db.exec("DROP INDEX IF EXISTS idx_site_trust_escrow_jti");
    const oldColumns = [
      ...(version < 2 ? [
        ["site_identity_keys", "key_id"], ["site_identity_keys", "key_sequence"],
        ["site_attestation_log", "att_jws"],
        ["site_trust_agent_verifications", "attestation_jti"], ["site_trust_agent_verifications", "attestation_jws"],
        ["site_trust_escrow_reports", "attestation_jti"], ["site_trust_escrow_reports", "attestation_jws"],
        ["site_trust_self_evaluations", "attestation_jti"], ["site_trust_self_evaluations", "attestation_jws"],
        ["usage_ledger", "reader_did"], ["authorized_escrow_providers", "public_key_jwk"],
      ] : []),
      ...(version < 3 ? [
        ["users", "email"], ["users", "provider"], ["users", "totp_secret"], ["users", "totp_enabled_at"],
        ["users", "oauth_provider"], ["users", "oauth_subject"], ["plugin_artifacts", "manifest_json"],
      ] : []),
    ];
    for (const [table, column] of oldColumns) {
      const columns = db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((row: any) => row.name);
      if (columns.includes(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    if (version < 4) db.exec("DROP TABLE IF EXISTS plugin_email_quota");
    db.exec("DELETE FROM schema_migrations WHERE version > " + Number(version));
    db.prepare("INSERT OR REPLACE INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)")
      .run("historical-admin", "preserved-hash", "admin", "2020-01-01T00:00:00.000Z");
    db.prepare("INSERT OR REPLACE INTO pages (slug,layout_json,updated_at,updated_by) VALUES (?,?,?,?)")
      .run("historical-page", JSON.stringify({ title: "Keep me" }), "2020-01-02T00:00:00.000Z", "historical-admin");
    db.prepare("INSERT OR REPLACE INTO site_skin (site_id,skin,tokens_json,updated_at) VALUES (?,?,?,?)")
      .run("default", "base", JSON.stringify({ accent: "#abc123" }), "2020-01-03T00:00:00.000Z");
  } finally {
    db.close();
  }
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

  it("leer currentVersion no crea ni altera schema_migrations", async () => {
    const path = tempDb();
    const db = new Database(path);
    db.exec("CREATE TABLE legacy_marker (id TEXT PRIMARY KEY)");
    expect(currentVersion(db)).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()).toBeUndefined();
    db.close();
  });

  it("DB nueva: bootstrap baseline, ejecuta deltas y no crea backup de pre-upgrade", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    expect(currentVersion(db)).toBe(schemaVersion());
    db.close();
    // Y no queda nada pendiente.
    const result = await migrateSqlite(path);
    expect(result.applied).toEqual([]);
    expect(result.from).toBe(schemaVersion());
    expect(existsSync(join(resolve(path, ".."), "backups"))).toBe(false);
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

describe("upgrade histórico y recuperación", () => {
  it("migra desde v1 con backup previo y conserva usuarios, páginas y configuración", async () => {
    const path = tempDb();
    await makeHistoricalDb(path, 1);

    const result = await migrateSqlite(path);
    expect(result.from).toBe(1);
    expect(result.to).toBe(schemaVersion());
    expect(result.applied).toEqual(["identity_and_attestation_columns", "user_and_plugin_columns", "email_capabilities", "page_revision_history", "page_revision_evidence", "page_revision_approvals", "mcp_audit_events", "publication_runs"]);
    expect(result.backupPath).toBeTruthy();

    const upgraded = await openSqlite(path);
    expect(currentVersion(upgraded)).toBe(schemaVersion());
    expect(upgraded.prepare("SELECT username,password_hash FROM users WHERE username='historical-admin'").get()).toMatchObject({
      username: "historical-admin",
      password_hash: "preserved-hash",
    });
    expect(JSON.parse(upgraded.prepare("SELECT layout_json FROM pages WHERE slug='historical-page'").get().layout_json).title).toBe("Keep me");
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='page_revisions'").get()).toBeTruthy();
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='page_revision_evidence'").get()).toBeTruthy();
    expect(JSON.parse(upgraded.prepare("SELECT tokens_json FROM site_skin WHERE site_id='default'").get().tokens_json).accent).toBe("#abc123");
    upgraded.close();

    const backup = await openSqlite(result.backupPath!);
    expect(currentVersion(backup)).toBe(1);
    expect(backup.prepare("SELECT username FROM users WHERE username='historical-admin'").get()).toBeTruthy();
    expect(backup.prepare("SELECT name FROM pragma_table_info('users') WHERE name='email'").get()).toBeUndefined();
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_email_quota'").get()).toBeUndefined();
    backup.close();
  });

  it("si v3 falla, revierte ese delta; restaura el backup y completa el upgrade", async () => {
    const path = tempDb();
    await makeHistoricalDb(path, 2);
    const db = await openSqlite(path);
    db.exec(`CREATE TRIGGER fail_version_three BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 3 BEGIN SELECT RAISE(ABORT, 'injected v3 failure'); END`);
    db.close();

    await expect(migrateSqlite(path)).rejects.toThrow("injected v3 failure");
    const backupPath = join(resolve(path, ".."), "backups");
    const backupFile = readdirSync(backupPath)
      .filter((name) => name.startsWith("db-v2-"))
      .map((name) => join(backupPath, name))
      .find((file) => existsSync(file));
    expect(backupFile).toBeTruthy();

    const failed = await openSqlite(path);
    expect(currentVersion(failed)).toBe(2);
    expect(failed.prepare("SELECT name FROM pragma_table_info('users') WHERE name='email'").get()).toBeUndefined();
    expect(failed.prepare("SELECT username FROM users WHERE username='historical-admin'").get()).toBeTruthy();
    failed.close();

    const restoredPath = join(resolve(path, ".."), "restored.db");
    copyFileSync(backupFile!, restoredPath);
    const restored = await openSqlite(restoredPath);
    expect(currentVersion(restored)).toBe(2);
    expect(restored.prepare("SELECT username FROM users WHERE username='historical-admin'").get()).toBeTruthy();
    restored.exec("DROP TRIGGER fail_version_three");
    restored.close();

    const recovered = await migrateSqlite(restoredPath);
    expect(recovered.from).toBe(2);
    expect(recovered.to).toBe(schemaVersion());
    expect(recovered.applied).toEqual(["user_and_plugin_columns", "email_capabilities", "page_revision_history", "page_revision_evidence", "page_revision_approvals", "mcp_audit_events", "publication_runs"]);
    const finalDb = await openSqlite(restoredPath);
    expect(currentVersion(finalDb)).toBe(schemaVersion());
    expect(finalDb.prepare("SELECT username FROM users WHERE username='historical-admin'").get()).toBeTruthy();
    finalDb.close();
  });
});

// --- v2/v3: consolidacion de los ALTER TABLE dispersos + gate de migraciones ---
import { applyColumnMigrations } from "../../packages/persistence-migrations/src/runner";
import { migrationStatus } from "../../packages/persistence-migrations/src/gate";
import { REQUIRED_SCHEMA_COLUMNS } from "../../packages/persistence-migrations/src/index";
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
    await applySchema(path, { quiet: true });
    const db = new Database(path);
    db.exec("DROP INDEX IF EXISTS idx_users_oauth");
    db.exec("DROP INDEX IF EXISTS idx_site_identity_keys_seq");
    db.exec("DROP TABLE schema_migrations");
    db.exec("ALTER TABLE users DROP COLUMN email");
    db.exec("ALTER TABLE users DROP COLUMN oauth_subject");
    db.exec("ALTER TABLE usage_ledger DROP COLUMN reader_did");
    db.exec("ALTER TABLE site_identity_keys DROP COLUMN key_id");
    db.exec("ALTER TABLE site_identity_keys DROP COLUMN key_sequence");
    db.exec("ALTER TABLE plugin_artifacts DROP COLUMN manifest_json");
    db.exec("DROP TABLE plugin_email_quota");
    db.prepare("INSERT INTO users (username,password_hash,role,created_at) VALUES ('legacy','h','admin','t')").run();
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

  it("path inexistente -> null y NO crea el archivo (R8)", async () => {
    const path = join(tempDb(), "no-existe.sqlite");
    expect(existsSync(path)).toBe(false);
    expect(await migrationStatus({ PORTALESS_SQLITE_PATH: path })).toBeNull();
    expect(existsSync(path)).toBe(false); // el gate no debe crear una DB vacia
  });

  it("base al dia -> pending=false, newer=false", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    await migrateSqlite(path);
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status).toMatchObject({ pending: false, newer: false, codeVersion: schemaVersion() });
  });

  it("R1: base pre-versionada inicializada -> NO bloquea (schema.sql es la forma actual)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("DROP TABLE schema_migrations"); // base creada por schema.sql, sin libro mayor
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status).toMatchObject({ pending: false, newer: false });
  });

  it("base sin ledger y sin columna requerida queda pendiente; migrar restaura el contrato", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("DROP TABLE schema_migrations");
    db.exec("ALTER TABLE users DROP COLUMN email");
    db.close();

    const before = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(before).toMatchObject({ legacy: true, pending: true });
    expect(before?.schemaErrors).toContain("users.email");

    const result = await migrateSqlite(path);
    expect(result.applied).toContain("user_and_plugin_columns");
    const after = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(after).toMatchObject({ dbVersion: schemaVersion(), pending: false, invalid: false });
  });

  it("ledger actual no oculta una columna real ausente", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.exec("ALTER TABLE users DROP COLUMN email");
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status).toMatchObject({ dbVersion: schemaVersion(), pending: true, invalid: true });
    await expect(migrateSqlite(path)).rejects.toThrow(/users.email/);
  });

  it("libro mayor atrasado -> pending=true (el middleware responde 503)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.prepare("DELETE FROM schema_migrations WHERE version >= 2").run(); // libro en v1
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status?.pending).toBe(true);
  });

  it("base mas nueva que el codigo -> newer=true (fail-closed)", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(schemaVersion() + 9, "future", "t");
    db.close();
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: path });
    expect(status?.newer).toBe(true);
  });

  // R1: el path de Cloudflare (D1) no puede tumbar un sitio sano.
  describe("D1 (Cloudflare)", () => {
    function d1Mock(tables: string[], ledgerRows: Array<[number, string, string]> | null, omitColumn?: string) {
      const availableTables = new Set([...tables, ...(ledgerRows === null ? [] : ["schema_migrations"])]);
      return {
        prepare(sql: string) {
          if (sql.includes("pragma_table_info")) {
            return {
              bind: (table: string) => ({
                all: async () => ({ results: availableTables.has(table) ? (REQUIRED_SCHEMA_COLUMNS[table] ?? []).filter((name) => `${table}.${name}` !== omitColumn).map((name) => ({ name })) : [] }),
              }),
            };
          }
          if (sql.includes("sqlite_master")) {
            return { all: async () => ({ results: [...availableTables].map((name) => ({ name })) }) };
          }
          return {
            all: async () => ({ results: (ledgerRows ?? []).map(([version, name]) => ({ version, name })) }),
          };
        },
      };
    }

    it("D1 inicializada SIN libro -> no bloquea (pre-versionada)", async () => {
      const status = await migrationStatus({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), null) });
      expect(status).toMatchObject({ pending: false, newer: false });
    });

    it("D1 vacia SIN libro -> null", async () => {
      expect(await migrationStatus({ DB: d1Mock([], null) })).toBeNull();
    });

    it("D1 con libro atrasado -> pending=true", async () => {
      const status = await migrationStatus({ DB: d1Mock(["users"], [[1, "baseline", "t"]]) });
      expect(status?.pending).toBe(true);
    });

    it("D1 con libro al dia -> pending=false", async () => {
      const ledger = MIGRATIONS.map(({ version, name }) => [version, name, "t"] as [number, string, string]);
      const status = await migrationStatus({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), ledger) });
      expect(status).toMatchObject({ pending: false, newer: false });
    });

    it("D1 no adopta como actual un schema sin columna obligatoria", async () => {
      const status = await migrationStatus({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), null, "users.email") });
      expect(status).toMatchObject({ legacy: true, pending: true, invalid: true });
      expect(status?.schemaErrors).toContain("users.email");
    });

    it("D1 detecta huecos en el ledger", async () => {
      const status = await migrationStatus({
        DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), [[1, "baseline", "t"], [4, "email_capabilities", "t"]]),
      });
      expect(status).toMatchObject({ pending: true, invalid: true });
      expect(status?.ledgerErrors).toContain("falta version 2 antes de 4");
    });
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

// R6: la DDL de plugin_email_quota vive en UNA sola fuente
// (packages/persistence-migrations/src/ddl.ts) que comparten el store y la
// migracion; el schema-additions que alimenta schema.sql no puede divergir.
describe("R6: DDL de plugin_email_quota en una sola fuente", () => {
  const normalize = (sql: string) =>
    sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*([(),])\s*/g, "$1")
      .trim()
      .replace(/;+$/, "");

  it("la constante y schema-additions/plugin-email-quota.sql coinciden", () => {
    const root = join(__dirname, "../..");
    const file = readFileSync(join(root, "schema-additions/plugin-email-quota.sql"), "utf8");
    const create = file.match(/CREATE TABLE[\s\S]*?\)\s*;/);
    expect(create, "CREATE TABLE en el addendum").toBeTruthy();
    expect(normalize(create![0])).toBe(normalize(PLUGIN_EMAIL_QUOTA_DDL));
  });

  it("la migracion v4 usa la MISMA constante (no una copia inline)", () => {
    const v4 = MIGRATIONS.find((m) => m.version === 4);
    expect(v4!.statements).toContain(PLUGIN_EMAIL_QUOTA_DDL);
  });
});

describe("MCP audit DDL: una sola fuente entre store, migration y schema", () => {
  const normalize = (sql: string) => sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim().replace(/;+$/, "");
  it("schema-additions coincide con el DDL de store/migration", () => {
    const root = join(__dirname, "../..");
    const file = readFileSync(join(root, "schema-additions/mcp-audit-events.sql"), "utf8");
    const statements = [
      file.match(/CREATE TABLE[\s\S]*?\)\s*;/)?.[0],
      file.match(/CREATE INDEX[\s\S]*?;/)?.[0],
      ...(file.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? []),
    ];
    expect(statements).toHaveLength(4);
    expect(statements.map((sql) => normalize(sql!))).toEqual([MCP_AUDIT_TABLE_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_NO_DELETE_DDL].map(normalize));
  });
  it("migration v8 usa las mismas constantes compartidas", () => {
    expect(MIGRATIONS.find((migration) => migration.version === 8)?.statements).toEqual([MCP_AUDIT_TABLE_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_NO_DELETE_DDL]);
  });
});
