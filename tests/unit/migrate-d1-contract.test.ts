import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../../packages/persistence-migrations/src/index";
import { acquireMigrationLock, migrationSql, migrationStatements } from "../../scripts/migrate-d1.mjs";

function schemaBefore(version: number): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  for (const migration of MIGRATIONS.filter((entry) => entry.version < version)) {
    for (const { table, column } of migration.addColumns ?? []) {
      schema[table] = [...(schema[table] ?? []), column];
    }
  }
  return schema;
}

describe("migrate:d1 per-delta contract (V5)", () => {
  it("records each migration only after its SQL, as the last statement", () => {
    for (const migration of MIGRATIONS) {
      const statements = migrationStatements(migration, schemaBefore(migration.version));
      expect(statements.at(-1), `v${migration.version}`).toMatch(
        new RegExp(`^INSERT INTO schema_migrations .*${migration.version}.*${migration.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`),
      );
      expect(statements.at(-2), `v${migration.version}`).toMatch(/^CREATE TABLE IF NOT EXISTS schema_migrations/);
      expect(statements.filter((statement) => statement.startsWith("INSERT INTO schema_migrations"))).toHaveLength(1);
    }
  });

  it("serializes a single delta with no unsupported transaction wrapper", () => {
    const migration = MIGRATIONS.find((entry) => entry.version === 9) ?? MIGRATIONS.at(-1)!;
    const sql = migrationSql(migrationStatements(migration, schemaBefore(migration.version)));
    expect(sql.endsWith("\n")).toBe(true);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);
    expect(sql.trim().split("\n").at(-1)).toMatch(/^INSERT INTO schema_migrations/);
  });
});

describe("migrate:d1 local advisory lock", () => {
  it("rejects a concurrent run and allows a stale lock to be reclaimed", () => {
    const dir = mkdtempSync(join(tmpdir(), "portaless-d1-lock-"));
    const lock = join(dir, "migration.lock");
    try {
      const release = acquireMigrationLock(lock, Date.now());
      expect(() => acquireMigrationLock(lock, Date.now())).toThrow(/migracion D1 esta en curso/);
      release();
      const stale = acquireMigrationLock(lock, Date.now() - 2 * 60 * 60 * 1000);
      stale();
      expect(() => acquireMigrationLock(lock, Date.now())).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
