// Almacenamiento de usuarios. Implementacion de referencia sobre un
// archivo JSON (pensado para self-hosted simple, versionable si se desea
// -- aunque el archivo real de produccion NUNCA debe commitearse a Git,
// ver .gitignore). Para instalaciones con mas de un puñado de usuarios,
// migrar a SQLite implementando la misma interfaz UsersStore.

import type { UserRecord, Role } from "./types";
import { hashPassword } from "./password";

export interface UsersStore {
  findByUsername(username: string): Promise<UserRecord | null>;
  createUser(username: string, plainPassword: string, role: Role): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
}

export class InMemoryUsersStore implements UsersStore {
  private users = new Map<string, UserRecord>();

  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.users.get(username) ?? null;
  }

  async createUser(username: string, plainPassword: string, role: Role): Promise<UserRecord> {
    if (this.users.has(username)) {
      throw new Error(`El usuario "${username}" ya existe.`);
    }
    const record: UserRecord = {
      username,
      passwordHash: hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
    };
    this.users.set(username, record);
    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()];
  }
}

/**
 * Crea el usuario administrador inicial si todavia no existe ninguno --
 * pensado para ejecutarse una sola vez en el primer despliegue (ver
 * docs/architecture/authentication.md, seccion "Primer usuario").
 */
export async function ensureInitialAdmin(
  store: UsersStore,
  username: string,
  plainPassword: string
): Promise<UserRecord> {
  const existing = await store.listUsers();
  if (existing.length > 0) {
    throw new Error("Ya existen usuarios registrados; no se crea un admin inicial de nuevo.");
  }
  return store.createUser(username, plainPassword, "admin");
}
