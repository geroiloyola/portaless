// Factory server-side de ElementPackStore: D1 (Cloudflare) -> SQLite
// (self-host) -> in-memory, mismo patron que store-factory.ts de PageStore.
//
// Nota sobre el seed: SQLite siembra el pack demo en open() (ver
// SqliteElementPackStore.seedIfEmpty). D1 asume la tabla ya creada por
// schema.sql y NO siembra -- la instalacion D1 nueva debe pasar por
// setup-d1.mjs / generate-schema. in-memory siembra para tests y para el
// editor cliente sin backend.

import type { ElementPackStore } from "./element-pack-store";
import { InMemoryElementPackStore } from "./element-pack-store";
import { D1ElementPackStore } from "./stores/d1-element-pack-store";
import { SqliteElementPackStore } from "./stores/sqlite-element-pack-store";

export interface ElementPackStoreEnv {
  DB?: D1Database;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createElementPackStore(env: ElementPackStoreEnv): Promise<ElementPackStore> {
  if (env.DB) {
    return new D1ElementPackStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteElementPackStore.open(env.PORTALESS_SQLITE_PATH);
  }
  return new InMemoryElementPackStore(true);
}
