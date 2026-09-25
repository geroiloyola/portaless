// packages/apw-resolver/src/did-apw/store-factory.ts
//
// Mismo patron de resolucion de backend que createAuthorizedEscrowProvidersStore
// / createPluginRegistryStore: env.DB (D1) -> env.PORTALESS_SQLITE_PATH (SQLite)
// -> InMemory (fallback dev/test, con aviso de que no persiste).

import { D1SiteIdentityStore, SqliteSiteIdentityStore, InMemorySiteIdentityStore, type SiteIdentityStore } from "./site-identity-store";

export async function createSiteIdentityStore(env: Record<string, any>): Promise<SiteIdentityStore> {
  if (env.DB) {
    return new D1SiteIdentityStore(env.DB, env);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(env.PORTALESS_SQLITE_PATH);
    return new SqliteSiteIdentityStore(db, env);
  }
  console.warn(
    "[site-identity-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemorySiteIdentityStore. La identidad did:apw generada NO persistira entre reinicios."
  );
  return new InMemorySiteIdentityStore(env);
}
