// Persistencia real de tokens de recuperacion de contrasena (self-hosted).
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(). Ademas consume() ahora es ATOMICO:
// UPDATE ... WHERE used_at IS NULL y se verifica changes === 1, asi dos
// requests concurrentes con el mismo token no pueden consumirlo ambas.
// Uso: const store = await SqlitePasswordResetStore.open(path);

import type { PasswordResetRequest } from "../types";
import type { PasswordResetStore } from "../password-reset-store";
import { randomBytes } from "node:crypto";
import { openSqlite } from "../../../sqlite-driver/src/open";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export class SqlitePasswordResetStore implements PasswordResetStore {
  private db: any;

  static async open(dbPath: string): Promise<SqlitePasswordResetStore> {
    return new SqlitePasswordResetStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqlitePasswordResetStore ya no acepta una ruta en el constructor (v0.0.9.27). " +
          "Usa: await SqlitePasswordResetStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
    `);
  }

  async create(username: string): Promise<PasswordResetRequest> {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const record: PasswordResetRequest = {
      token,
      username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    };

    this.db
      .prepare(
        "INSERT INTO password_reset_requests (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .run(record.token, record.username, record.createdAt, record.expiresAt);

    return record;
  }

  async consume(token: string): Promise<PasswordResetRequest | null> {
    const row = this.db
      .prepare(
        "SELECT token, username, created_at, expires_at, used_at FROM password_reset_requests WHERE token = ?"
      )
      .get(token) as
      | { token: string; username: string; created_at: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare("DELETE FROM password_reset_requests WHERE token = ?").run(token);
      return null;
    }

    const usedAt = new Date().toISOString();
    const info = this.db
      .prepare("UPDATE password_reset_requests SET used_at = ? WHERE token = ? AND used_at IS NULL")
      .run(usedAt, token);
    if (info.changes !== 1) return null;

    return {
      token: row.token,
      username: row.username,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt,
    };
  }

  async invalidateAllForUser(username: string): Promise<void> {
    this.db.prepare("DELETE FROM password_reset_requests WHERE username = ?").run(username);
  }

  close(): void {
    this.db.close();
  }
}
