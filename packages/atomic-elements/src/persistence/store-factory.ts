// Factory server-side de PageStore: elige D1 (Cloudflare Pages) o SQLite
// (self-hosted) segun el entorno disponible. Ambas implementaciones cumplen
// la interfaz PageStore ya definida en ./page-store.ts (load/save/list),
// la misma que usa LocalStoragePageStore en el editor cliente.
// Mismo patron que packages/permissions/src/store-factory.ts y
// packages/trust-layer/src/ledger/store-factory.ts.
//
// v0.0.9.3: se corrige un bug real -- este archivo esperaba el binding D1
// como `env.PORTALESS_DB`, mientras que `wrangler.toml` y las otras 3
// factories (auth, permissions, trust-layer) usan `env.DB`. Con solo el
// binding `DB` configurado en una instancia real de Cloudflare Pages (como
// documenta wrangler.toml), PageStore nunca veia D1 y caia siempre a
// SQLite. Se alinea a `env.DB` aqui. No se mantiene alias con el nombre
// viejo porque ningun despliegue real llego a usarlo (el binding D1 nunca
// estuvo configurado en produccion hasta ahora).
//
// Se renombra tambien PAGES_SQLITE_PATH -> PORTALESS_SQLITE_PATH para
// compartir la misma variable de entorno que auth/permissions/trust-layer
// (un solo archivo SQLite self-hosted para todo, en vez de 4 archivos
// separados). Aqui SI se mantiene el nombre viejo como fallback, porque a
// diferencia del binding D1, un self-hosted real podria ya tener
// PAGES_SQLITE_PATH configurado apuntando a un archivo con datos.

import type { PageStore } from "./page-store";
import { D1PageStore } from "./stores/d1-page-store";
import { SqlitePageStore } from "./stores/sqlite-page-store";

export interface PageStoreEnv {
  DB?: D1Database;
  PORTALESS_SQLITE_PATH?: string;
  /** @deprecated usar DB -- se mantiene solo por compatibilidad, ver nota arriba. */
  PORTALESS_DB?: D1Database;
  /** @deprecated usar PORTALESS_SQLITE_PATH -- se mantiene solo por compatibilidad, ver nota arriba. */
  PAGES_SQLITE_PATH?: string;
}

export async function createPageStore(env: PageStoreEnv): Promise<PageStore> {
  const d1 = env.DB ?? env.PORTALESS_DB;
  if (d1) {
    return new D1PageStore(d1);
  }
  const dbPath = env.PORTALESS_SQLITE_PATH ?? env.PAGES_SQLITE_PATH ?? "./data/pages.sqlite";
  return new SqlitePageStore(dbPath);
}
