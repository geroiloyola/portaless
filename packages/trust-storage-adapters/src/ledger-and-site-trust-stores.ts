// Portaless node factories for UsageLedgerStore and SiteTrustScoreStore (Node-L0).
import { InMemoryUsageLedgerStore, type UsageLedgerStore } from "../../trust-layer/src/ledger/log-writer";
import { InMemorySiteTrustScoreStore, type SiteTrustScoreStore } from "../../trust-layer/src/site-trust/site-trust-score";
import { SqliteUsageLedgerStore } from "./sqlite-log-store";
import { SqliteSiteTrustScoreStore } from "./sqlite-site-trust-store";

export { SqliteUsageLedgerStore, SqliteSiteTrustScoreStore };

export interface LedgerStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createUsageLedgerStore(env: LedgerStoreFactoryEnv): Promise<UsageLedgerStore> {
  if (env.DB) {
    const { D1UsageLedgerStore } = await import("../../trust-layer/src/ledger/d1-log-store");
    return new D1UsageLedgerStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteUsageLedgerStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless Trust Layer] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  return new InMemoryUsageLedgerStore();
}

export interface SiteTrustStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createSiteTrustScoreStore(
  env: SiteTrustStoreFactoryEnv,
): Promise<SiteTrustScoreStore> {
  if (env.DB) {
    const { D1SiteTrustScoreStore } = await import(
      "../../trust-layer/src/site-trust/stores/d1-site-trust-store"
    );
    return new D1SiteTrustScoreStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteSiteTrustScoreStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless SiteTrustScore] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  return new InMemorySiteTrustScoreStore();
}
