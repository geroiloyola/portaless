// Gate de migraciones: protege la integridad de los datos cuando el codigo
// nuevo corre contra una base vieja (o al reves). El middleware lo consulta
// antes de servir nada y responde 503 "Pending Database Migrations" en vez de
// dejar que una columna ausente rompa una query a mitad de camino.
//
// Fail-closed: una base MAS NUEVA que el codigo tambien bloquea (no se degrada
// el schema). Sin base configurada (hosting estatico) no hay gate.
//
// IMPORTANTE (R1): una base PRE-VERSIONADA (tablas de app creadas por
// schema.sql, pero SIN tabla `schema_migrations`) NO se bloquea. `schema.sql`
// es la forma ACTUAL del schema y se aplica entero al crear la base, asi que
// una base sin libro mayor esta al dia por construccion -- bloquearla tumbaria
// todo despliegue de Cloudflare (donde el operador aplica schema.sql via
// wrangler y nunca corre el runner self-host). El `doctor` avisa que conviene
// estampar el libro (scripts/stamp-d1.mjs) para que el gate tenga version real.
// El gate SOLO bloquea cuando el libro existe y esta atras (pending) o adelante
// (newer): ahi si hay una divergencia verificable.
import { schemaVersion } from "./index.ts";

export interface MigrationStatus {
  dbVersion: number;
  codeVersion: number;
  pending: boolean;
  newer: boolean;
}

export interface MigrationGateEnv {
  DB?: any;
  PORTALESS_SQLITE_PATH?: string;
}

const APP_TABLES = ["users", "pages"];

function hasTable(db: any, name: string): boolean {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  } catch {
    return false;
  }
}

async function d1HasTable(db: any, name: string): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(name)
      .first();
    return Boolean(row);
  } catch {
    return false;
  }
}

/** Una base pre-versionada inicializada cuenta como "al dia" (no bloquea). */
function upToDate(codeVersion: number): MigrationStatus {
  return { dbVersion: codeVersion, codeVersion, pending: false, newer: false };
}

/**
 * Lee el estado del contrato de datos. @returns null si no hay base (hosting
 * estatico) o si la base esta vacia (nada que proteger).
 */
export async function migrationStatus(env: MigrationGateEnv): Promise<MigrationStatus | null> {
  const codeVersion = schemaVersion();

  if (env.DB) {
    if (!(await d1HasTable(env.DB, "schema_migrations"))) {
      const initialized = (await d1HasTable(env.DB, "users")) || (await d1HasTable(env.DB, "pages"));
      return initialized ? upToDate(codeVersion) : null;
    }
    let dbVersion: number;
    try {
      const row = await env.DB.prepare("SELECT MAX(version) AS v FROM schema_migrations").first();
      dbVersion = Number(row?.v ?? 0);
    } catch {
      dbVersion = 0;
    }
    return { dbVersion, codeVersion, pending: dbVersion < codeVersion, newer: dbVersion > codeVersion };
  }

  if (env.PORTALESS_SQLITE_PATH) {
    // R8: si el archivo no existe, NO abrir SQLite -- `new Database(path)` lo
    // crearia vacio como efecto colateral de un simple chequeo.
    const { existsSync } = await import("node:fs");
    if (!existsSync(env.PORTALESS_SQLITE_PATH)) return null;

    let db: any;
    try {
      db = await openSqliteLazy(env.PORTALESS_SQLITE_PATH);
    } catch {
      return null; // sin SQLite (workerd sin D1): no hay gate
    }
    try {
      if (!hasTable(db, "schema_migrations")) {
        const initialized = APP_TABLES.some((t) => hasTable(db, t));
        return initialized ? upToDate(codeVersion) : null;
      }
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
      const dbVersion = Number(row?.v ?? 0);
      return { dbVersion, codeVersion, pending: dbVersion < codeVersion, newer: dbVersion > codeVersion };
    } catch {
      return null;
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
