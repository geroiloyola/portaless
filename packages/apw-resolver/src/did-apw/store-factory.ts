// packages/apw-resolver/src/did-apw/store-factory.ts
//
// Mismo patron de resolucion de backend que createAuthorizedEscrowProvidersStore
// / createPluginRegistryStore: env.DB (D1) -> env.PORTALESS_SQLITE_PATH (SQLite)
// -> InMemory (fallback dev/test, con aviso de que no persiste).
//
// v0.0.9.27: SQLite via openSqlite() (better-sqlite3 + guardia de runtime
// workerd) en vez de node:sqlite. Misma API prepare/run/get/all/exec, por lo
// que SqliteSiteIdentityStore no cambia. Si PORTALESS_SQLITE_PATH esta
// definido y SQLite no abre, se lanza el error (nunca cae a memoria).
//
// APW v1.2 (seccion 5.4): createAttestationLogStore() sigue el mismo patron
// para el historial encadenado.

import { D1SiteIdentityStore, SqliteSiteIdentityStore, InMemorySiteIdentityStore, type SiteIdentityStore } from "./site-identity-store";
import {
  D1AttestationLogStore,
  SqliteAttestationLogStore,
  InMemoryAttestationLogStore,
  type AttestationLogStore,
} from "./attestation-log-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

export async function createSiteIdentityStore(env: Record<string, any>): Promise<SiteIdentityStore> {
  if (env.DB) {
    return new D1SiteIdentityStore(env.DB, env);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteSiteIdentityStore(db, env);
  }
  console.warn(
    "[site-identity-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemorySiteIdentityStore. La identidad did:apw generada NO persistira entre reinicios."
  );
  return new InMemorySiteIdentityStore(env);
}

export async function createAttestationLogStore(env: Record<string, any>): Promise<AttestationLogStore> {
  if (env.DB) {
    return new D1AttestationLogStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteAttestationLogStore(db);
  }
  console.warn(
    "[attestation-log-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemoryAttestationLogStore. El historial encadenado NO persistira entre reinicios."
  );
  return new InMemoryAttestationLogStore();
}
