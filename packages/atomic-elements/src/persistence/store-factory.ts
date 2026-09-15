// Factory server-side de PageStore: elige D1 (Cloudflare Pages) o SQLite
// (self-hosted) segun el entorno disponible. Ambas implementaciones cumplen
// la interfaz PageStore ya definida en ./page-store.ts (load/save/list),
// la misma que usa LocalStoragePageStore en el editor cliente.
// Mismo patron que packages/permissions/src/store-factory.ts y
// packages/trust-layer/src/ledger/store-factory.ts.

import type { PageStore } from "./page-store";
import { D1PageStore } from "./stores/d1-page-store";
import { SqlitePageStore } from "./stores/sqlite-page-store";

export interface PageStoreEnv {
  PORTALESS_DB?: D1Database;
  PAGES_SQLITE_PATH?: string;
}

export async function createPageStore(env: PageStoreEnv): Promise<PageStore> {
  if (env.PORTALESS_DB) {
    return new D1PageStore(env.PORTALESS_DB);
  }
  const dbPath = env.PAGES_SQLITE_PATH ?? "./data/pages.sqlite";
  return new SqlitePageStore(dbPath);
}
