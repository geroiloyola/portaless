// Factory del CapabilityTokenStore -- mismo patron de eleccion D1 vs
// SQLite vs InMemory que store-factory.ts de @portaless/permissions y
// packages/plugin-sandbox/src/registry/store-factory.ts (plugin registry).
// env.DB (D1) tiene prioridad; si no esta, cae a SQLite self-hosted via
// env.PORTALESS_SQLITE_PATH (better-sqlite3 via openSqlite -- v0.0.9.27:
// antes usaba node:sqlite pese a que este comentario decia better-sqlite3,
// y reventaba en Node < 22.5); si ninguno esta presente, cae a memoria
// (con aviso, no persiste entre restarts).

import {
  D1CapabilityTokenStore,
  SqliteCapabilityTokenStore,
  InMemoryCapabilityTokenStore,
  type CapabilityTokenStore,
} from "./capability-token-store";
import { openSqlite } from "../../../../sqlite-driver/src/open";

interface EnvLike {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

let cachedSqliteStore: CapabilityTokenStore | null = null;
let cachedInMemoryStore: CapabilityTokenStore | null = null;

export async function createCapabilityTokenStore(env: EnvLike): Promise<CapabilityTokenStore> {
  if (env.DB) {
    return new D1CapabilityTokenStore(env.DB as never);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    if (!cachedSqliteStore) {
      const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
      db.exec(`
        CREATE TABLE IF NOT EXISTS capability_bridge_tokens (
          token TEXT PRIMARY KEY,
          plugin_name TEXT NOT NULL,
          granted_capabilities_json TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_capability_bridge_tokens_expires_at
          ON capability_bridge_tokens(expires_at);
      `);
      cachedSqliteStore = new SqliteCapabilityTokenStore({
        prepare: (sql: string) => {
          const stmt = db.prepare(sql);
          return {
            run: (...args: unknown[]) => {
              const info = stmt.run(...(args as never[]));
              return { changes: Number((info as { changes?: number }).changes ?? 0) };
            },
            get: (...args: unknown[]) => stmt.get(...(args as never[])) as Record<string, unknown> | undefined,
          };
        },
      });
    }
    return cachedSqliteStore;
  }

  console.warn(
    "[Portaless CapabilityBridge] Sin DB ni PORTALESS_SQLITE_PATH -- usando memoria para tokens del bridge. " +
      "Los tokens emitidos no sobreviven un restart del proceso."
  );

  if (!cachedInMemoryStore) {
    cachedInMemoryStore = new InMemoryCapabilityTokenStore();
  }
  return cachedInMemoryStore;
}
