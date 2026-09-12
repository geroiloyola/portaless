// Persistencia real de sesiones sobre Cloudflare D1. Mismo binding "DB"
// que d1-users-store.ts.

import { randomBytes } from "node:crypto";
import type { SessionRecord, Role } from "../types";
import type { SessionStore } from "../session-store";
import type { D1DatabaseLike } from "./d1-users-store";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class D1SessionStore implements SessionStore {
  constructor(private db: D1DatabaseLike) {}

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

    await this.db
      .prepare("INSERT INTO sessions (token, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(record.token, record.username, record.role, record.createdAt, record.expiresAt)
      .run();

    return record;
  }

  async get(token: string): Promise<SessionRecord | null> {
    const row = await this.db
      .prepare("SELECT token, username, role, created_at, expires_at FROM sessions WHERE token = ?")
      .bind(token)
      .first<{ token: string; username: string; role: Role; created_at: string; expires_at: string }>();

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
    await this.db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
}
