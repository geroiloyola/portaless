// Fabrica de persistencia de SiteTrustScore -- v0.0.9.15. Mismo patron
// exacto que packages/permissions/src/store-factory.ts: D1 si env.DB
// existe (Cloudflare Workers), SQLite si env.PORTALESS_SQLITE_PATH existe
// (self-hosted, Node 22.5+), memoria como ultimo recurso -- nunca falla
// silenciosamente, siempre advierte por que cayo a memoria.

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
    try {
      const { SqliteSiteTrustScoreStore } = await import("./stores/sqlite-site-trust-store");
      return new SqliteSiteTrustScoreStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(`[Portaless SiteTrustScore] SQLite no disponible (${(err as Error).message}). Usando memoria.`);
    }
  } else {
    console.warn("[Portaless SiteTrustScore] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  }

  return new InMemorySiteTrustScoreStore();
}
