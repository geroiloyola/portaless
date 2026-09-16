// Persistencia real de tokens de recuperacion de contrasena para
// despliegues self-hosted -- mismo patron que sqlite-users-store.ts y
// sqlite-session-store.ts del PR #4 original (node:sqlite / DatabaseSync,
// requiere Node 22.5+). La tabla password_reset_requests ya existe en
// schema.sql (raiz, agregada en v0.0.9.4) -- este store la usa via
// CREATE TABLE IF NOT EXISTS por si se instancia sin haber corrido
// npm run setup primero.

import type { PasswordResetRequest } from "../types";
import type { PasswordResetStore } from "../password-reset-store";
import { randomBytes } from "node:crypto";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export class SqlitePasswordResetStore implements PasswordResetStore {
  private db: any;

  constructor(dbPath: string) {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      throw new Error(
        "node:sqlite no esta disponible en este runtime. Requiere Node 22.5+."
      );
    }
    this.db = new DatabaseSync(dbPath);
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
    this.db.prepare("UPDATE password_reset_requests SET used_at = ? WHERE token = ?").run(usedAt, token);

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
}
