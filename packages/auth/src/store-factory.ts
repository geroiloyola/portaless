// Punto unico de decision: que backend de persistencia usar segun el
// entorno de ejecucion. Sigue el mismo principio multi-proveedor que
// packages/plugin-sandbox/src/adapters/adapter-registry.ts.

import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import { InMemoryUsersStore } from "./users-store";
import { InMemorySessionStore } from "./session-store";

export interface StoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createUsersStore(env: StoreFactoryEnv): Promise<UsersStore> {
  if (env.DB) {
    const { D1UsersStore } = await import("./stores/d1-users-store");
    return new D1UsersStore(env.DB as any);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqliteUsersStore } = await import("./stores/sqlite-users-store");
      return new SqliteUsersStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(
        `[Portaless Auth] No se pudo inicializar SQLite (${(err as Error).message}). ` +
        "Usando almacenamiento EN MEMORIA -- los usuarios se perderán al reiniciar."
      );
    }
  } else {
    console.warn(
      "[Portaless Auth] Ni DB (D1) ni PORTALESS_SQLITE_PATH están configurados. " +
      "Usando almacenamiento EN MEMORIA -- los usuarios se perderán al reiniciar."
    );
  }

  return new InMemoryUsersStore();
}

export async function createSessionStore(env: StoreFactoryEnv): Promise<SessionStore> {
  if (env.DB) {
    const { D1SessionStore } = await import("./stores/d1-session-store");
    return new D1SessionStore(env.DB as any);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqliteSessionStore } = await import("./stores/sqlite-session-store");
      return new SqliteSessionStore(env.PORTALESS_SQLITE_PATH);
    } catch {
      // El warning ya se emitió en createUsersStore.
    }
  }

  return new InMemorySessionStore();
}
