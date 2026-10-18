// Persistencia real de usuarios sobre Cloudflare D1 -- disponible cuando
// el sitio corre en Cloudflare Pages/Workers con un binding "DB" (ver
// wrangler.toml). Usa el mismo esquema que stores/schema.sql.
//
// v0.0.9.10: superficie completa de UsersStore (antes faltaban los
// metodos de TOTP y OAuth y habilitarlos en produccion reventaba con
// "not a function"). Como D1UsersStore no tiene DDL en el constructor
// (async), el schema se asegura en la primera operacion via ensure():
// CREATE TABLE IF NOT EXISTS + ALTER TABLE para bases creadas antes de
// v0.0.9.10; el "duplicate column" de una base nueva se ignora (mismo
// patron que D1EmailStepUpStore y site_identity_keys).

import type { UserRecord, Role } from "../types";
import type { UsersStore } from "../users-store";
import { oauthFallbackPasswordHash } from "../users-store";
import { hashPassword } from "../password";

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

const USERS_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    email TEXT,
    provider TEXT,
    totp_secret TEXT,
    totp_enabled_at TEXT,
    oauth_provider TEXT,
    oauth_subject TEXT
  )
`;

const USERS_OAUTH_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject)";

const USERS_COLUMNS = [
  "username",
  "password_hash",
  "role",
  "created_at",
  "email",
  "provider",
  "totp_secret",
  "totp_enabled_at",
  "oauth_provider",
  "oauth_subject",
];

type UsersRow = {
  username: string;
  password_hash: string;
  role: Role;
  created_at: string;
  email: string | null;
  provider: string | null;
  totp_secret: string | null;
  totp_enabled_at: string | null;
  oauth_provider: string | null;
  oauth_subject: string | null;
};

function rowToRecord(row: UsersRow): UserRecord {
  return {
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    email: row.email ?? undefined,
    provider: (row.provider as UserRecord["provider"]) ?? undefined,
    totpSecret: row.totp_secret ?? undefined,
    totpEnabledAt: row.totp_enabled_at ?? undefined,
    oauthProvider: row.oauth_provider ?? undefined,
    oauthSubject: row.oauth_subject ?? undefined,
  };
}

export class D1UsersStore implements UsersStore {
  private ready?: Promise<unknown>;

  constructor(private db: D1DatabaseLike) {}

  private ensure() {
    return (this.ready ??= (async () => {
      await this.db.prepare(USERS_DDL).bind().run();
      // Las columnas agregadas a bases viejas viven en la migracion numerada v3
      // (packages/persistence-migrations); el runner corre en el arranque.
      await this.db.prepare(USERS_OAUTH_INDEX_DDL).bind().run();
    })());
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    await this.ensure();
    const row = await this.db
      .prepare(`SELECT ${USERS_COLUMNS.join(", ")} FROM users WHERE username = ?`)
      .bind(username)
      .first<UsersRow>();

    if (!row) return null;
    return rowToRecord(row);
  }

  async createUser(
    username: string,
    plainPassword: string,
    role: Role,
    email?: string
  ): Promise<UserRecord> {
    await this.ensure();
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "password",
    };

    await this.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, email, provider) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(record.username, record.passwordHash, record.role, record.createdAt, email ?? null, "password")
      .run();

    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare(`SELECT ${USERS_COLUMNS.join(", ")} FROM users`)
      .bind()
      .all<UsersRow>();

    return results.map(rowToRecord);
  }

  // Cambio de contrasena (AuthService.changePassword) y completar el
  // reset (AuthService.completePasswordReset). Sin esto el flujo revienta
  // con "setPasswordByUsername is not a function" en Cloudflare.
  async setPasswordByUsername(username: string, plainPassword: string): Promise<void> {
    await this.ensure();
    const result = await this.db
      .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
      .bind(hashPassword(plainPassword), username)
      .run() as { success?: boolean; meta?: { changes?: number } };
    if (result?.meta?.changes === 0) throw new Error(`El usuario "${username}" no existe.`);
  }

  async setTotpSecret(username: string, secret: string): Promise<void> {
    await this.ensure();
    const result = await this.db
      .prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = ? WHERE username = ?")
      .bind(secret, new Date().toISOString(), username)
      .run() as { meta?: { changes?: number } };
    if (result?.meta?.changes === 0) throw new Error(`El usuario "${username}" no existe.`);
  }

  async clearTotpSecret(username: string): Promise<void> {
    await this.ensure();
    const result = await this.db
      .prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE username = ?")
      .bind(username)
      .run() as { meta?: { changes?: number } };
    if (result?.meta?.changes === 0) throw new Error(`El usuario "${username}" no existe.`);
  }

  async findByOAuthSubject(provider: string, subject: string): Promise<UserRecord | null> {
    await this.ensure();
    const row = await this.db
      .prepare(
        `SELECT ${USERS_COLUMNS.join(", ")} FROM users WHERE oauth_provider = ? AND oauth_subject = ?`
      )
      .bind(provider, subject)
      .first<UsersRow>();

    if (!row) return null;
    return rowToRecord(row);
  }

  async linkOAuthAccount(username: string, provider: string, subject: string): Promise<void> {
    await this.ensure();
    const result = await this.db
      .prepare("UPDATE users SET oauth_provider = ?, oauth_subject = ? WHERE username = ?")
      .bind(provider, subject, username)
      .run() as { meta?: { changes?: number } };
    if (result?.meta?.changes === 0) throw new Error(`El usuario "${username}" no existe.`);
  }

  async createOAuthUser(
    username: string,
    provider: string,
    subject: string,
    role: Role,
    email?: string
  ): Promise<UserRecord> {
    await this.ensure();
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: oauthFallbackPasswordHash(),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "oauth",
      oauthProvider: provider,
      oauthSubject: subject,
    };

    await this.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, email, provider, oauth_provider, oauth_subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        record.username,
        record.passwordHash,
        record.role,
        record.createdAt,
        email ?? null,
        "oauth",
        provider,
        subject
      )
      .run();

    return record;
  }
}
