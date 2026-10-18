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

  it("estampar el baseline en una base recien creada por schema.sql", async () => {
    const path = tempDb();
    await applySchema(path, { quiet: true });
    const db = await openSqlite(path);
    expect(currentVersion(db)).toBe(0); // aun sin schema_migrations con filas
    db.close();

    const result = await migrateSqlite(path);
    expect(result.from).toBe(0);
    expect(result.to).toBe(schemaVersion());
    expect(result.applied).toContain("baseline");

    const db2 = await openSqlite(path);
    expect(currentVersion(db2)).toBe(schemaVersion());
    db2.close();
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
    const dry = await migrateSqlite(path, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.applied).toContain("baseline");
    expect(dry.backupPath).toBeNull();
    const db = await openSqlite(path);
    expect(currentVersion(db)).toBe(0); // sigue sin estampar
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
    const result = await migrateSqlite(path);
    expect(result.backupPath).toBeTruthy();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readdirSync(join(resolve(path, ".."), "backups")).length).toBeGreaterThan(0);
  });
});
