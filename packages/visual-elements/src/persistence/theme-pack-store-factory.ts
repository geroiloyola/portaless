// Factory server-side de ThemePackStore: D1 (Cloudflare) -> SQLite
// (self-host) -> in-memory, mismo patron que element-pack-store-factory.ts
// y store-factory.ts de PageStore.
//
// Nota sobre el seed: NINGUN backend siembra. Los packs builtin viven en
// themes/theme-pack.ts y el catalogo efectivo (builtin ∪ instalado) se
// arma con availableThemes() en el caller (index.ts del MCP), no aqui.

import type { ThemePackStore } from "./theme-pack-store";
import { InMemoryThemePackStore } from "./theme-pack-store";
import { D1ThemePackStore } from "./stores/d1-theme-pack-store";
import { SqliteThemePackStore } from "./stores/sqlite-theme-pack-store";

export interface ThemePackStoreEnv {
  DB?: D1Database;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createThemePackStore(env: ThemePackStoreEnv): Promise<ThemePackStore> {
  if (env.DB) {
    return new D1ThemePackStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteThemePackStore.open(env.PORTALESS_SQLITE_PATH);
  }
  return new InMemoryThemePackStore();
}
