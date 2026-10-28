// Persistencia real de usuarios para despliegues self-hosted (sin Cloudflare).
// v0.0.9.27: migrado de node:sqlite a better-sqlite3 via openSqlite().
// Motivo: node:sqlite requiere Node 22.5+, y se cargaba con require() en un
// paquete ESM, donde require no existe -- el constructor lanzaba SIEMPRE y
// createUsersStore() caia a InMemoryUsersStore en silencio (admin perdido).
//
// v0.0.9.10: superficie completa de UsersStore. Antes faltaban
// setTotpSecret/clearTotpSecret/findByOAuthSubject/linkOAuthAccount/
// createOAuthUser (solo existian en InMemoryUsersStore), asi que habilitar
// 2FA o login con OAuth en self-host reventaba con "not a function". Las
// columnas nuevas (email, provider, totp_*, oauth_*) se agregan solas con
// ALTER TABLE a bases viejas (mismo patron que site_identity_keys); en una
// base nueva el CREATE TABLE ya las trae y el ALTER falla con "duplicate
// column", que se ignora.
//
// Uso: const store = await SqliteUsersStore.open(path);
// El constructor recibe una conexion ya abierta; pasarle un string lanza
// un error explicito en vez de fallar de forma ambigua.

import type { UserRecord, Role } from "../types";
import type { UsersStore } from "../users-store";
import { oauthFallbackPasswordHash } from "../users-store";
import { hashPassword } from "../password";
import { openSqlite } from "../../../sqlite-driver/src/open";

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
] as const;

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
  );
`;

// Las columnas agregadas a bases creadas antes de v0.0.9.10 viven ahora en la
// migracion numerada v3 (packages/persistence-migrations/src/index.ts). El
// CREATE TABLE de arriba ya las trae para una base nueva.

const USERS_OAUTH_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject)";

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

export class SqliteUsersStore implements UsersStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteUsersStore> {
    return new SqliteUsersStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteUsersStore ya no acepta una ruta en el constructor (v0.0.9.27). " +
          "Usa: await SqliteUsersStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(USERS_DDL);
    // Las columnas que antes se agregaban con ALTER TABLE dispersos viven ahora
    // en la migracion numerada v3 (packages/persistence-migrations). El runner
    // corre en el arranque (server/first-run.mjs) antes de abrir los stores.
    this.db.exec(USERS_OAUTH_INDEX_DDL);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare(`SELECT ${USERS_COLUMNS.join(", ")} FROM users WHERE username = ?`)
      .get(username) as UsersRow | undefined;

    if (!row) return null;
    return rowToRecord(row);
  }

  async createUser(
    username: string,
    plainPassword: string,
    role: Role,
    email?: string
  ): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: await hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "password",
    };

    this.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, email, provider) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(record.username, record.passwordHash, record.role, record.createdAt, email ?? null, "password");

    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = this.db
      .prepare(`SELECT ${USERS_COLUMNS.join(", ")} FROM users`)
      .all() as UsersRow[];

    return rows.map(rowToRecord);
  }

  // Cambio de contrasena ( AuthService.changePassword ) y completar el
  // reset ( AuthService.completePasswordReset ). Sin esto el flujo
  // revienta con "setPasswordByUsername is not a function" en self-host.
  async setPasswordByUsername(username: string, plainPassword: string): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
      .run(await hashPassword(plainPassword), username) as { changes: number };
    if (!result?.changes) throw new Error(`El usuario "${username}" no existe.`);
  }

  async setTotpSecret(username: string, secret: string): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = ? WHERE username = ?")
      .run(secret, new Date().toISOString(), username) as { changes: number };
    if (!result?.changes) throw new Error(`El usuario "${username}" no existe.`);
  }

  async clearTotpSecret(username: string): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE username = ?")
      .run(username) as { changes: number };
    if (!result?.changes) throw new Error(`El usuario "${username}" no existe.`);
  }

  async findByOAuthSubject(provider: string, subject: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare(
        `SELECT ${USERS_COLUMNS.join(", ")} FROM users WHERE oauth_provider = ? AND oauth_subject = ?`
      )
      .get(provider, subject) as UsersRow | undefined;

    if (!row) return null;
    return rowToRecord(row);
  }

  async linkOAuthAccount(username: string, provider: string, subject: string): Promise<void> {
    const result = this.db
      .prepare("UPDATE users SET oauth_provider = ?, oauth_subject = ? WHERE username = ?")
      .run(provider, subject, username) as { changes: number };
    if (!result?.changes) throw new Error(`El usuario "${username}" no existe.`);
  }

  async createOAuthUser(
    username: string,
    provider: string,
    subject: string,
    role: Role,
    email?: string
  ): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: await oauthFallbackPasswordHash(),
      role,
      createdAt: new Date().toISOString(),
      email,
      provider: "oauth",
      oauthProvider: provider,
      oauthSubject: subject,
    };

    this.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, email, provider, oauth_provider, oauth_subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        record.username,
        record.passwordHash,
        record.role,
        record.createdAt,
        email ?? null,
        "oauth",
        provider,
        subject
      );

    return record;
  }

  close(): void {
    this.db.close();
  }
}
