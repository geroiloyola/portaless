// Fabrica de persistencia del Centro de Permisos.
// v0.0.9.27: si PORTALESS_SQLITE_PATH esta definido y SQLite no abre, se LANZA
// el error (antes caia a memoria en silencio: los permisos concedidos se
// perdian al reiniciar). Memoria solo si no hay ni DB ni ruta.
import type { PermissionStore } from "./permission-store";
import { InMemoryPermissionStore } from "./permission-store";

export interface PermissionStoreFactoryEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string; }

export async function createPermissionStore(env: PermissionStoreFactoryEnv): Promise<PermissionStore> {
  if (env.DB) {
    const { D1PermissionStore } = await import("./stores/d1-permission-store");
    return new D1PermissionStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    const { SqlitePermissionStore } = await import("./stores/sqlite-permission-store");
    return SqlitePermissionStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless Permissions] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  return new InMemoryPermissionStore();
}
