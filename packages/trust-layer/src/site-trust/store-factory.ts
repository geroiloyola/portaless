// Fabrica de persistencia de SiteTrustScore -- v0.0.9.15. Mismo patron
// exacto que packages/permissions/src/store-factory.ts: D1 si env.DB
// existe (Cloudflare Workers), SQLite si env.PORTALESS_SQLITE_PATH existe
// (self-hosted), memoria solo si no hay ninguno de los dos configurado.
//
// v0.0.9.27: si PORTALESS_SQLITE_PATH esta definido y SQLite no abre, se
// LANZA el error. Antes caia a memoria con un console.warn: el sitio servia
// un SiteTrustScore vacio como si fuera real y los votos/reportes se
// perdian al reiniciar -- un aviso en el log no evita que eso sea un fallo
// silencioso para quien consume el score.

import type { SiteTrustScoreStore } from "./site-trust-score";
import { InMemorySiteTrustScoreStore } from "./site-trust-score";

export interface SiteTrustStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createSiteTrustScoreStore(
  env: SiteTrustStoreFactoryEnv
): Promise<SiteTrustScoreStore> {
  if (env.DB) {
    const { D1SiteTrustScoreStore } = await import("./stores/d1-site-trust-store");
    return new D1SiteTrustScoreStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const { SqliteSiteTrustScoreStore } = await import("./stores/sqlite-site-trust-store");
    return SqliteSiteTrustScoreStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless SiteTrustScore] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  return new InMemorySiteTrustScoreStore();
}
