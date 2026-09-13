// Fabrica de persistencia del Centro de Permisos.
import type { PermissionStore } from "./permission-store";
import { InMemoryPermissionStore } from "./permission-store";

export interface PermissionStoreFactoryEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string; }

export async function createPermissionStore(env: PermissionStoreFactoryEnv): Promise<PermissionStore> {
  if (env.DB) {
    const { D1PermissionStore } = await import("./stores/d1-permission-store");
    return new D1PermissionStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqlitePermissionStore } = await import("./stores/sqlite-permission-store");
      return new SqlitePermissionStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(`[Portaless Permissions] SQLite no disponible (${(err as Error).message}). Usando memoria.`);
    }
  } else {
    console.warn("[Portaless Permissions] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  }
  return new InMemoryPermissionStore();
}
