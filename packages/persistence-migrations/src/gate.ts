// Gate de migraciones: protege la integridad de los datos cuando el codigo
// nuevo corre contra una base vieja (o al reves). El middleware lo consulta
// antes de servir nada y responde 503 "Pending Database Migrations" en vez de
// dejar que una columna ausente rompa una query a mitad de camino.
//
// Fail-closed: una base MAS NUEVA que el codigo tambien bloquea (no se degrada
// el schema). Sin base configurada (hosting estatico) no hay gate.
import { openSqlite } from "../../sqlite-driver/src/open.ts";
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

function hasTable(db: any, name: string): boolean {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  } catch {
    return false;
  }
}

/** Lee la version de la base. @returns null si no hay base (hosting estatico). */
export async function migrationStatus(env: MigrationGateEnv): Promise<MigrationStatus | null> {
  const codeVersion = schemaVersion();
  let dbVersion: number;

  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT MAX(version) AS v FROM schema_migrations").first();
      dbVersion = Number(row?.v ?? 0);
    } catch {
      dbVersion = 0; // tabla ausente: base pre-versionada
    }
  } else if (env.PORTALESS_SQLITE_PATH) {
    let db: any;
    try {
      db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    } catch {
      return null; // sin SQLite (workerd sin D1): no hay gate
    }
    try {
      // Una base SIN libro mayor y SIN tablas de app es una base nueva/vacia
      // (p.ej. un test, o el primer arranque antes de applySchema): no hay nada
      // que proteger. El gate solo aplica a una base de app inicializada.
      if (!hasTable(db, "schema_migrations") && !hasTable(db, "users") && !hasTable(db, "pages")) {
        return null;
      }
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
      dbVersion = Number(row?.v ?? 0);
    } catch {
      dbVersion = 0;
    } finally {
      db.close();
    }
  } else {
    return null;
  }

  return { dbVersion, codeVersion, pending: dbVersion < codeVersion, newer: dbVersion > codeVersion };
}
