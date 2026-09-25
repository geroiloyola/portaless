// Punto unico de decision: que backend de persistencia usar segun el
// entorno de ejecucion. Sigue el mismo principio multi-proveedor que
// packages/plugin-sandbox/src/adapters/adapter-registry.ts.
//
// v0.0.9.6: createPasswordResetStore() ya resuelve D1/SQLite reales,
// mismo patron que createUsersStore/createSessionStore.
//
// v0.0.9.27 -- REGLA NUEVA: si PORTALESS_SQLITE_PATH esta definido y SQLite
// no abre, se LANZA el error. Antes habia un try/catch que caia a memoria:
// combinado con node:sqlite (inexistente en Node 20 y cargado con require en
// ESM), el self-host SIEMPRE corria en memoria y el admin creado por
// `npm run setup` nunca se encontraba en /admin/login. El fallback a memoria
// queda SOLO para cuando no hay ni DB ni PORTALESS_SQLITE_PATH, con aviso.

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
    const { SqliteUsersStore } = await import("./stores/sqlite-users-store");
    return SqliteUsersStore.open(env.PORTALESS_SQLITE_PATH);
  }

  console.warn(
    "[Portaless Auth] Ni DB (D1) ni PORTALESS_SQLITE_PATH están configurados. " +
    "Usando almacenamiento EN MEMORIA -- los usuarios se perderán al reiniciar."
  );
  return new InMemoryUsersStore();
}

export async function createSessionStore(env: StoreFactoryEnv): Promise<SessionStore> {
  if (env.DB) {
    const { D1SessionStore } = await import("./stores/d1-session-store");
    return new D1SessionStore(env.DB as any);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    const { SqliteSessionStore } = await import("./stores/sqlite-session-store");
    return SqliteSessionStore.open(env.PORTALESS_SQLITE_PATH);
  }

  return new InMemorySessionStore();
}

export async function createPasswordResetStore(env: StoreFactoryEnv): Promise<PasswordResetStore> {
  if (env.DB) {
    const { D1PasswordResetStore } = await import("./stores/d1-password-reset-store");
    return new D1PasswordResetStore(env.DB as any);
  }

  if (env.PORTALESS_SQLITE_PATH) {
    const { SqlitePasswordResetStore } = await import("./stores/sqlite-password-reset-store");
    return SqlitePasswordResetStore.open(env.PORTALESS_SQLITE_PATH);
  }

  console.warn(
    "[Portaless Auth] Ni DB (D1) ni PORTALESS_SQLITE_PATH están configurados para password reset. " +
    "Usando almacenamiento EN MEMORIA -- los tokens de recuperación se perderán al reiniciar."
  );
  return new InMemoryPasswordResetStore();
}
