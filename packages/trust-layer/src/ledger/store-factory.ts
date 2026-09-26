// Fabrica de persistencia del ledger del Trust Layer.
// v0.0.9.27: si PORTALESS_SQLITE_PATH esta definido y SQLite no abre, se LANZA
// el error (antes caia a memoria en silencio: el uso y la facturacion de
// agentes se perdian al reiniciar). Memoria solo si no hay ni DB ni ruta.
import type { UsageLedgerStore } from "./log-writer";
import { InMemoryUsageLedgerStore } from "./log-writer";

export interface LedgerStoreFactoryEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string; }

export async function createUsageLedgerStore(env: LedgerStoreFactoryEnv): Promise<UsageLedgerStore> {
  if (env.DB) {
    const { D1UsageLedgerStore } = await import("./d1-log-store");
    return new D1UsageLedgerStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const { SqliteUsageLedgerStore } = await import("./sqlite-log-store");
    return SqliteUsageLedgerStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless Trust Layer] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  return new InMemoryUsageLedgerStore();
}
