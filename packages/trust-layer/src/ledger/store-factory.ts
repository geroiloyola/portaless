// Fabrica de persistencia del ledger del Trust Layer.
import type { UsageLedgerStore } from "./log-writer";
import { InMemoryUsageLedgerStore } from "./log-writer";

export interface LedgerStoreFactoryEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string; }

export async function createUsageLedgerStore(env: LedgerStoreFactoryEnv): Promise<UsageLedgerStore> {
  if (env.DB) {
    const { D1UsageLedgerStore } = await import("./d1-log-store");
    return new D1UsageLedgerStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqliteUsageLedgerStore } = await import("./sqlite-log-store");
      return new SqliteUsageLedgerStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(`[Portaless Trust Layer] SQLite no disponible (${(err as Error).message}). Usando memoria.`);
    }
  } else {
    console.warn("[Portaless Trust Layer] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  }
  return new InMemoryUsageLedgerStore();
}
