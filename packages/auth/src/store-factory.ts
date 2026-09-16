// Punto unico de decision: que backend de persistencia usar segun el
// entorno de ejecucion. Sigue el mismo principio multi-proveedor que
// packages/plugin-sandbox/src/adapters/adapter-registry.ts.
//
// v0.0.9.4: se agrega createPasswordResetStore(). D1/SQLite reales para
// reset de contrasena quedan fuera de alcance de esta version (ver
// ROADMAP.md) -- el reset store usa siempre memoria por ahora porque sus
// tokens son de vida muy corta (30 min) y perderlos en un restart es un
// impacto menor comparado con usuarios/sesiones.

import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import type { PasswordResetStore } from "./password-reset-store";
import { InMemoryUsersStore } from "./users-store";
import { InMemorySessionStore } from "./session-store";
import { InMemoryPasswordResetStore } from "./password-reset-store";

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

/**
 * v0.0.9.4: siempre en memoria por ahora -- ver nota de alcance arriba.
 */
export async function createPasswordResetStore(_env: StoreFactoryEnv): Promise<PasswordResetStore> {
  return new InMemoryPasswordResetStore();
}
