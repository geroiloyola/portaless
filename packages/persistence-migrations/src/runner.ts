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
import { assertCompatible, pendingFrom, schemaVersion } from "./index.ts";

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
  /** Directorio del backup. Default: <dirname(sqlitePath)>/backups */
  backupDir?: string;
  now?: () => Date;
}

/** Version actual de la base (0 si no hay tabla / filas). */
export function currentVersion(db: any): number {
  db.exec(CREATE_TABLE);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
  return Number(row?.v ?? 0);
}

async function backupDatabase(db: any, sqlitePath: string, from: number, opts: MigrateOptions): Promise<string> {
  const dir = opts.backupDir || join(dirname(sqlitePath), "backups");
  mkdirSync(dir, { recursive: true });
  const ts = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `db-v${from}-${ts}.sqlite`);
  await db.backup(dest);
  return dest;
}

export async function migrateSqlite(sqlitePath: string, opts: MigrateOptions = {}): Promise<MigrateResult> {
  if (!existsSync(sqlitePath)) {
    // Base nueva: no hay nada que migrar. `schema.sql` la crea al arrancar y el
    // baseline se registra entonces.
    return { from: 0, to: 0, applied: [], backupPath: null, dryRun: Boolean(opts.dryRun) };
  }
  const db = await openSqlite(sqlitePath);
  try {
    const from = currentVersion(db);
    assertCompatible(from);
    const pending = pendingFrom(from);
    if (pending.length === 0) {
      return { from, to: from, applied: [], backupPath: null, dryRun: Boolean(opts.dryRun) };
    }
    if (opts.dryRun) {
      return { from, to: schemaVersion(), applied: pending.map((m) => m.name), backupPath: null, dryRun: true };
    }

    const backupPath = await backupDatabase(db, sqlitePath, from, opts);
    const applied: string[] = [];
    for (const migration of pending) {
      db.exec("BEGIN");
      try {
        for (const statement of migration.statements) db.exec(statement);
        db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          migration.version,
          migration.name,
          (opts.now?.() ?? new Date()).toISOString(),
        );
        db.exec("COMMIT");
        applied.push(migration.name);
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    return { from, to: schemaVersion(), applied, backupPath, dryRun: false };
  } finally {
    db.close();
  }
}
