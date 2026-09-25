// Persistencia real de sesiones para despliegues self-hosted.
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(), mismo cambio que sqlite-users-store.ts.
// Uso: const store = await SqliteSessionStore.open(path);

import { randomBytes } from "node:crypto";
import type { SessionRecord, Role } from "../types";
import type { SessionStore } from "../session-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SqliteSessionStore implements SessionStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteSessionStore> {
    return new SqliteSessionStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteSessionStore ya no acepta una ruta en el constructor (v0.0.9.27). " +
          "Usa: await SqliteSessionStore.open(path)"
      );
    }
    this.db = db;
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

  close(): void {
    this.db.close();
  }
}
