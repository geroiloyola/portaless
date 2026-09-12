// Persistencia real de sesiones para despliegues self-hosted. Mismo
// motor (node:sqlite) y mismas advertencias que sqlite-users-store.ts.

import { randomBytes } from "node:crypto";
import type { SessionRecord, Role } from "../types";
import type { SessionStore } from "../session-store";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SqliteSessionStore implements SessionStore {
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
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  async create(username: string, role: Role): Promise<SessionRecord> {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const record: SessionRecord = {
      token,
      username,
      role,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };

    this.db
      .prepare("INSERT INTO sessions (token, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.token, record.username, record.role, record.createdAt, record.expiresAt);

    return record;
  }

  async get(token: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare("SELECT token, username, role, created_at, expires_at FROM sessions WHERE token = ?")
      .get(token) as { token: string; username: string; role: Role; created_at: string; expires_at: string } | undefined;

    if (!row) return null;

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.destroy(token);
      return null;
    }

    return {
      token: row.token,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async destroy(token: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}
