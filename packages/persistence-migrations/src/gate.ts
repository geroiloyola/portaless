// Gate de migraciones: contrasta ledger Y esquema real antes de servir.
import {
  BASELINE_REQUIRED_COLUMNS,
  MIGRATIONS,
  REQUIRED_SCHEMA_COLUMNS,
  missingSchemaColumns,
  schemaVersion,
} from "./index.ts";

export interface MigrationStatus {
  dbVersion: number;
  codeVersion: number;
  pending: boolean;
  newer: boolean;
  invalid: boolean;
  legacy: boolean;
  schemaErrors: string[];
  ledgerErrors: string[];
}

export interface MigrationGateEnv {
  DB?: any;
  PORTALESS_SQLITE_PATH?: string;
}

function makeStatus(
  dbVersion: number,
  codeVersion: number,
  options: Partial<Pick<MigrationStatus, "legacy" | "schemaErrors" | "ledgerErrors" | "pending">> = {},
): MigrationStatus {
  const schemaErrors = options.schemaErrors ?? [];
  const ledgerErrors = options.ledgerErrors ?? [];
  const newer = dbVersion > codeVersion;
  const pending = options.pending ?? (dbVersion < codeVersion || schemaErrors.length > 0 || ledgerErrors.length > 0);
  return {
    dbVersion,
    codeVersion,
    pending,
    newer,
    invalid: schemaErrors.length > 0 || ledgerErrors.length > 0,
    legacy: options.legacy ?? false,
    schemaErrors,
    ledgerErrors,
  };
}

function sqliteTableNames(db: any): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row: { name: string }) => row.name);
}

function sqliteColumns(db: any, table: string): string[] {
  return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((row: { name: string }) => row.name);
}

function sqliteSchema(db: any): Record<string, string[]> {
  const tableNames = sqliteTableNames(db);
  const names = new Set(tableNames);
  const tables = new Set([
    ...Object.keys(REQUIRED_SCHEMA_COLUMNS),
    ...MIGRATIONS.flatMap((migration) => (migration.addColumns ?? []).map((item) => item.table)),
  ]);
  return {
    ...Object.fromEntries([...tables].map((table) => [table, names.has(table) ? sqliteColumns(db, table) : []])),
    __portaless_has_tables: tableNames.length ? ["present"] : [],
  };
}

function sqliteLedger(db: any): { present: boolean; version: number; errors: string[] } {
  const exists = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("schema_migrations"),
  );
  if (!exists) return { present: false, version: 0, errors: [] };
  const rows = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string }>;
  return validateLedger(rows);
}

function validateLedger(rows: Array<{ version: number; name: string }>): { present: true; version: number; errors: string[] } {
  const expected = new Map(MIGRATIONS.map((migration) => [migration.version, migration.name]));
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const version = Number(row.version);
    if (seen.has(version)) errors.push(`version ${version} duplicada`);
    seen.add(version);
    if (expected.get(version) !== row.name) errors.push(`version ${version} tiene nombre inesperado (${row.name})`);
  }
  const max = rows.reduce((value, row) => Math.max(value, Number(row.version)), 0);
  for (const migration of MIGRATIONS) {
    if (migration.version <= max && !seen.has(migration.version)) errors.push(`falta version ${migration.version} antes de ${max}`);
  }
  return { present: true, version: max, errors };
}

async function d1TableNames(db: any): Promise<string[]> {
  const result = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return (result.results ?? []).map((row: { name: string }) => row.name);
}

async function d1Columns(db: any, table: string): Promise<string[]> {
  const result = await db.prepare("SELECT name FROM pragma_table_info(?)").bind(table).all();
  return (result.results ?? []).map((row: { name: string }) => row.name);
}

async function d1Schema(db: any): Promise<Record<string, string[]>> {
  const tableNames = await d1TableNames(db);
  const names = new Set(tableNames);
  const tables = new Set([
    ...Object.keys(REQUIRED_SCHEMA_COLUMNS),
    ...MIGRATIONS.flatMap((migration) => (migration.addColumns ?? []).map((item) => item.table)),
  ]);
  const entries = await Promise.all(
    [...tables].map(async (table) => [table, names.has(table) ? await d1Columns(db, table) : []] as const),
  );
  return {
    ...Object.fromEntries(entries),
    __portaless_has_tables: tableNames.length ? ["present"] : [],
  };
}

async function d1Ledger(db: any): Promise<{ present: boolean; version: number; errors: string[] }> {
  const names = new Set(await d1TableNames(db));
  if (!names.has("schema_migrations")) return { present: false, version: 0, errors: [] };
  const result = await db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
  return validateLedger(result.results ?? []);
}

function resolveStatus(
  schema: Record<string, string[]>,
  ledger: { present: boolean; version: number; errors: string[] },
  codeVersion: number,
): MigrationStatus | null {
  const actualTables = Object.values(schema).some((columns) => columns.length > 0);
  if (!ledger.present && !actualTables) return null;

  const schemaErrors = missingSchemaColumns(schema);
  if (!ledger.present) {
    // Solo el esquema completo autoriza adopción como actual. Una DB que aún
    // carece de columnas de migración se presenta como pendiente, nunca como vN.
    if (schemaErrors.length === 0) return makeStatus(0, codeVersion, { legacy: true, pending: false });
    const baselineErrors = missingSchemaColumns(schema, BASELINE_REQUIRED_COLUMNS);
    return makeStatus(0, codeVersion, {
      legacy: true,
      schemaErrors: baselineErrors.length ? baselineErrors : schemaErrors,
    });
  }

  return makeStatus(ledger.version, codeVersion, {
    schemaErrors,
    ledgerErrors: ledger.errors,
  });
}

/** Lee el ledger y el contrato de columnas. No modifica la DB; null solo si no hay DB configurada/vacía. */
export async function migrationStatus(env: MigrationGateEnv): Promise<MigrationStatus | null> {
  const codeVersion = schemaVersion();

  if (env.DB) {
    const [schema, ledger] = await Promise.all([d1Schema(env.DB), d1Ledger(env.DB)]);
    return resolveStatus(schema, ledger, codeVersion);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    const { existsSync } = await import("node:fs");
    if (!existsSync(env.PORTALESS_SQLITE_PATH)) return null;
    const db = await openSqliteLazy(env.PORTALESS_SQLITE_PATH);
    try {
      return resolveStatus(sqliteSchema(db), sqliteLedger(db), codeVersion);
    } finally {
      db.close();
    }
  }

  return null;
}

/** Import perezoso del driver SQLite (no arrastra better-sqlite3 al bundle edge). */
async function openSqliteLazy(path: string): Promise<any> {
  const { openSqlite } = await import("../../sqlite-driver/src/open.ts");
  return openSqlite(path);
}
