// Punto unico de decision: que backend de persistencia usar segun el
// entorno de ejecucion. Sigue el mismo principio multi-proveedor que
// packages/plugin-sandbox/src/adapters/adapter-registry.ts.
//
// v0.0.9.6: createPasswordResetStore() ya resuelve D1/SQLite reales,
// mismo patron que createUsersStore/createSessionStore -- antes solo
// devolvia InMemoryPasswordResetStore sin importar el backend
// configurado, perdiendo los tokens de recuperacion pendientes en cada
// restart del proceso/Worker (ver ROADMAP.md, tarea manual 7).

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
 * v0.0.9.6: resuelve D1/SQLite reales, mismo patron que createUsersStore
 * y createSessionStore arriba. Antes de este cambio, siempre devolvia
 * InMemoryPasswordResetStore sin importar env -- los tokens de
 * recuperacion (vida corta, 30 min) se perdian en cada restart del
 * proceso/Worker, aunque D1/SQLite ya estuvieran configurados para
 * usuarios y sesiones. La tabla password_reset_requests ya existe desde
 * v0.0.9.4 en schema.sql (raiz).
 */
export async function createPasswordResetStore(env: StoreFactoryEnv): Promise<PasswordResetStore> {
  if (env.DB) {
    const { D1PasswordResetStore } = await import("./stores/d1-password-reset-store");
    return new D1PasswordResetStore(env.DB as any);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqlitePasswordResetStore } = await import("./stores/sqlite-password-reset-store");
      return new SqlitePasswordResetStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(
        `[Portaless Auth] No se pudo inicializar SQLite para password reset (${(err as Error).message}). ` +
        "Usando almacenamiento EN MEMORIA -- los tokens de recuperación se perderán al reiniciar."
      );
    }
  } else {
    console.warn(
      "[Portaless Auth] Ni DB (D1) ni PORTALESS_SQLITE_PATH están configurados para password reset. " +
      "Usando almacenamiento EN MEMORIA -- los tokens de recuperación se perderán al reiniciar."
    );
  }

  return new InMemoryPasswordResetStore();
}
