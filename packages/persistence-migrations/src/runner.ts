// Runner de migraciones sobre SQLite (self-host y Docker). D1 se aplica con
// `wrangler d1 migrations apply` (documentado en el deploy de Cloudflare).
//
// Garantias:
//   - BACKUP automatico (via la API de better-sqlite3) antes de migrar, salvo
//     --dry-run. El backup queda en <dataDir>/backups/db-vN-<ts>.sqlite.
//   - TRANSACCION por migracion: si una falla, se revierte y el arranque corta.
//   - IDEMPOTENTE: re-ejecutar no hace nada cuando ya esta al dia.
//   - FAIL-CLOSED: una base mas nueva que el codigo no migra (assertCompatible).
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openSqlite } from "../../sqlite-driver/src/open.ts";
import {
  BASELINE_REQUIRED_COLUMNS,
  MIGRATIONS,
  REQUIRED_SCHEMA_COLUMNS,
  SchemaContractError,
  assertCompatible,
  missingSchemaColumns,
  pendingFrom,
  schemaVersion,
  type Migration,
} from "./index.ts";

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
  dryRun: boolean;
}

export interface MigrateOptions {
  dryRun?: boolean;
  /** Internal bootstrap path: schema.sql just created this DB, so there is no pre-upgrade state to back up. */
  skipBackup?: boolean;
  /** Directorio del backup. Default: <dirname(sqlitePath)>/backups */
  backupDir?: string;
  now?: () => Date;
}

function hasMigrationLedger(db: any): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("schema_migrations"),
  );
}

/** Version actual de la base (0 si no hay tabla / filas). Esta lectura no crea ni modifica el ledger. */
export function currentVersion(db: any): number {
  if (!hasMigrationLedger(db)) return 0;
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
  return Number(row?.v ?? 0);
}

/** Registra una migracion que ya fue aplicada dentro de la transaccion del caller. */
export function recordAppliedMigration(db: any, migration: Migration, appliedAt = new Date().toISOString()): void {
  db.exec(CREATE_TABLE);
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
    migration.version,
    migration.name,
    appliedAt,
  );
}

async function backupDatabase(db: any, sqlitePath: string, from: number, opts: MigrateOptions): Promise<string> {
  const dir = opts.backupDir || join(dirname(sqlitePath), "backups");
  mkdirSync(dir, { recursive: true });
  const ts = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `db-v${from}-${ts}.sqlite`);
  await db.backup(dest);
  return dest;
}

/** Columnas de una tabla (portable: `pragma_table_info` existe en SQLite y D1). */
function tableColumns(db: any, table: string): string[] {
  try {
    return (db.prepare("SELECT name FROM pragma_table_info(?)").all(table) as Array<{ name: string }>).map((r) => r.name);
  } catch {
    return [];
  }
}

function schemaColumns(db: any): Record<string, string[]> {
  const tables = new Set([
    ...Object.keys(REQUIRED_SCHEMA_COLUMNS),
    ...MIGRATIONS.flatMap((migration) => (migration.addColumns ?? []).map((item) => item.table)),
  ]);
  return Object.fromEntries([...tables].map((table) => [table, tableColumns(db, table)]));
}

function projectMigrations(actual: Record<string, string[]>, pending: Migration[]): Record<string, string[]> {
  const projected = Object.fromEntries(Object.entries(actual).map(([table, columns]) => [table, [...columns]]));
  for (const migration of pending) {
    for (const { table, column } of migration.addColumns ?? []) {
      if (table in projected && !projected[table].includes(column)) projected[table].push(column);
    }
    for (const [table, columns] of Object.entries(migration.createsTables ?? {})) {
      projected[table] = [...new Set([...(projected[table] ?? []), ...columns])];
    }
  }
  return projected;
}

function assertLedgerContiguous(db: any, version: number): void {
  if (!hasMigrationLedger(db)) return;
  const rows = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string }>;
  const expected = new Map(MIGRATIONS.map((migration) => [migration.version, migration.name]));
  const seen = new Set<number>();
  for (const row of rows) {
    const rowVersion = Number(row.version);
    if (seen.has(rowVersion) || expected.get(rowVersion) !== row.name) {
      throw new Error(`Ledger de migraciones invalido en version ${rowVersion} (${row.name}).`);
    }
    seen.add(rowVersion);
  }
  for (let v = 1; v <= version; v++) {
    if (!seen.has(v)) throw new Error(`Ledger de migraciones incompleto: falta la version ${v} antes de ${version}.`);
  }
}

function applyColumnsFor(db: any, migration: Migration): void {
  for (const { table, column, type } of migration.addColumns ?? []) {
    const columns = tableColumns(db, table);
    // Tabla ausente: la crea el STORE con todas sus columnas (schema.sql no la
    // trae). No es un error: el store usa CREATE TABLE IF NOT EXISTS completo.
    if (columns.length === 0) continue;
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Aplica SOLO las columnas de TODAS las migraciones a una conexion ya abierta,
 * de forma idempotente. Lo usa el runner (por migracion) y sirve para migrar
 * una conexion en memoria (tests) sin pasar por un archivo.
 */
export function applyColumnMigrations(db: any): void {
  for (const migration of MIGRATIONS) applyColumnsFor(db, migration);
}

function applyMigration(db: any, migration: Migration): void {
  for (const statement of migration.statements) db.exec(statement);
  applyColumnsFor(db, migration);
}

export async function migrateSqlite(sqlitePath: string, opts: MigrateOptions = {}): Promise<MigrateResult> {
  if (!existsSync(sqlitePath)) {
    // Base nueva: no hay nada que migrar. `schema.sql` la crea al arrancar y el
    // baseline se registra entonces.
    return { from: 0, to: 0, applied: [], backupPath: null, dryRun: Boolean(opts.dryRun) };
  }
  const db = await openSqlite(sqlitePath);
  try {
    const objects = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
      .get();
    if (Number(objects?.n ?? 0) === 0) {
      return { from: 0, to: 0, applied: [], backupPath: null, dryRun: Boolean(opts.dryRun) };
    }

    const from = currentVersion(db);
    assertCompatible(from);
    assertLedgerContiguous(db, from);
    const pending = pendingFrom(from);
    if (pending.length === 0) {
      const schemaErrors = missingSchemaColumns(schemaColumns(db));
      if (schemaErrors.length) throw new SchemaContractError(schemaErrors);
      return { from, to: from, applied: [], backupPath: null, dryRun: Boolean(opts.dryRun) };
    }

    const actualSchema = schemaColumns(db);
    const baselineErrors = missingSchemaColumns(actualSchema, BASELINE_REQUIRED_COLUMNS);
    if (baselineErrors.length) throw new SchemaContractError(baselineErrors);

    const projectedErrors = missingSchemaColumns(projectMigrations(actualSchema, pending));
    if (projectedErrors.length) throw new SchemaContractError(projectedErrors);
    if (opts.dryRun) {
      return { from, to: schemaVersion(), applied: pending.map((m) => m.name), backupPath: null, dryRun: true };
    }

    const backupPath = opts.skipBackup ? null : await backupDatabase(db, sqlitePath, from, opts);
    const applied: string[] = [];
    for (const migration of pending) {
      db.exec("BEGIN");
      try {
        // Si no existia ledger, el baseline se registra en la primera transaccion
        // que aplica. Nunca se escribe al leer ni antes de respaldar.
        db.exec(CREATE_TABLE);
        applyMigration(db, migration);
        recordAppliedMigration(db, migration, (opts.now?.() ?? new Date()).toISOString());
        db.exec("COMMIT");
        applied.push(migration.name);
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    const schemaErrors = missingSchemaColumns(schemaColumns(db));
    if (schemaErrors.length) throw new SchemaContractError(schemaErrors);
    return { from, to: schemaVersion(), applied, backupPath, dryRun: false };
  } finally {
    db.close();
  }
}
