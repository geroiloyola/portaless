// Almacenamiento de usuarios. Implementacion de referencia sobre un
// archivo JSON (pensado para self-hosted simple, versionable si se desea
// -- aunque el archivo real de produccion NUNCA debe commitearse a Git,
// ver .gitignore). Para instalaciones con mas de un puñado de usuarios,
// migrar a SQLite implementando la misma interfaz UsersStore.
//
// v0.0.9.4: se agregan metodos para 2FA (setTotpSecret/clearTotpSecret),
// recuperacion de contrasena (setPasswordByUsername) y OAuth
// (findByOAuthSubject/linkOAuthAccount), ademas de email opcional en
// createUser. Todo aditivo -- findByUsername/createUser/listUsers
// mantienen su firma original.

import type { UserRecord, Role, AuthProvider } from "./types";
import { hashPassword } from "./password";

export interface UsersStore {
  findByUsername(username: string): Promise<UserRecord | null>;
  createUser(username: string, plainPassword: string, role: Role, email?: string): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  setPasswordByUsername(username: string, plainPassword: string): Promise<void>;
  setTotpSecret(username: string, secret: string): Promise<void>;
  clearTotpSecret(username: string): Promise<void>;
  findByOAuthSubject(provider: string, subject: string): Promise<UserRecord | null>;
  linkOAuthAccount(username: string, provider: string, subject: string): Promise<void>;
  createOAuthUser(username: string, provider: string, subject: string, role: Role, email?: string): Promise<UserRecord>;
}

export class InMemoryUsersStore implements UsersStore {
  private users = new Map<string, UserRecord>();

  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.users.get(username) ?? null;
  }

  async createUser(username: string, plainPassword: string, role: Role, email?: string): Promise<UserRecord> {
    if (this.users.has(username)) {
      throw new Error(`El usuario "${username}" ya existe.`);
    }
    const record: UserRecord = {
      username,
      passwordHash: hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "password",
    };
    this.users.set(username, record);
    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()];
  }

  async setPasswordByUsername(username: string, plainPassword: string): Promise<void> {
    const record = this.users.get(username);
    if (!record) throw new Error(`El usuario "${username}" no existe.`);
    record.passwordHash = hashPassword(plainPassword);
  }

  async setTotpSecret(username: string, secret: string): Promise<void> {
    const record = this.users.get(username);
    if (!record) throw new Error(`El usuario "${username}" no existe.`);
    record.totpSecret = secret;
    record.totpEnabledAt = new Date().toISOString();
  }

  async clearTotpSecret(username: string): Promise<void> {
    const record = this.users.get(username);
    if (!record) throw new Error(`El usuario "${username}" no existe.`);
    delete record.totpSecret;
    delete record.totpEnabledAt;
  }

  async findByOAuthSubject(provider: string, subject: string): Promise<UserRecord | null> {
    for (const record of this.users.values()) {
      if (record.oauthProvider === provider && record.oauthSubject === subject) return record;
    }
    return null;
  }

  async linkOAuthAccount(username: string, provider: string, subject: string): Promise<void> {
    const record = this.users.get(username);
    if (!record) throw new Error(`El usuario "${username}" no existe.`);
    record.oauthProvider = provider;
    record.oauthSubject = subject;
  }

  async createOAuthUser(
    username: string,
    provider: string,
    subject: string,
    role: Role,
    email?: string
  ): Promise<UserRecord> {
    if (this.users.has(username)) {
      throw new Error(`El usuario "${username}" ya existe.`);
    }
    const record: UserRecord = {
      username,
      passwordHash: hashPassword(randomFallbackPassword()),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "oauth",
      oauthProvider: provider,
      oauthSubject: subject,
    };
    this.users.set(username, record);
    return record;
  }
}

/** Usuarios OAuth no usan password propio -- se genera un hash aleatorio inutilizable como fallback defensivo. */
function randomFallbackPassword(): string {
  return `oauth-managed:${Math.random().toString(36)}:${Date.now()}`;
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
