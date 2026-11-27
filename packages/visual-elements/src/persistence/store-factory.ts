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
//
// v0.0.9.27: SqlitePageStore se abre via SqlitePageStore.open() (better-sqlite3
// + guardia de runtime workerd en openSqlite). Sin DB y dentro de workerd,
// ahora falla con el mensaje arquitectonico claro en vez de un error
// criptico de node:sqlite.

import type { PageStore } from "./page-store";
import { D1PageStore } from "./stores/d1-page-store";
import { SqlitePageStore } from "./stores/sqlite-page-store";
import { createElementPackStore } from "./element-pack-store-factory";
import { catalogFromStore } from "./element-pack-store";
import { elementRegistry, elementPalette } from "../elements/registry";

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
  let store: PageStore;
  if (d1) {
    store = new D1PageStore(d1);
  } else {
    const dbPath = env.PORTALESS_SQLITE_PATH ?? env.PAGES_SQLITE_PATH ?? "./data/pages.sqlite";
    store = await SqlitePageStore.open(dbPath);
  }

  // Best-effort: cablea el catalogo resuelto (core ∪ element packs) para que
  // save() acepte tipos contribuidos por un pack. Si la carga de packs falla
  // (sin DB, entorno sin permisos, pack corrupto), se valida contra el core y
  // los tipos de pack quedan rechazados -- nunca tira abajo el PageStore.
  try {
    const packStore = await createElementPackStore(env);
    const catalog = await catalogFromStore(packStore, elementRegistry, elementPalette);
    store.setCatalog?.(catalog);
  } catch {
    // Sin catalogo de packs: validacion core-only (comportamiento previo).
  }

  return store;
}
