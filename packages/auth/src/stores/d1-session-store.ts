// Persistencia real de sesiones sobre Cloudflare D1. Mismo binding "DB"
// que d1-users-store.ts.
//
// v0.0.9.30: destroyAllForUser() -- cierra todas las sesiones de un
// usuario (cambio o reset de contrasena).

import { randomBytes } from "node:crypto";
import type { SessionRecord, Role } from "../types";
import { hashOpaqueToken } from "../token-hash";
import type { SessionStore } from "../session-store";
import type { D1DatabaseLike } from "./d1-users-store";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class D1SessionStore implements SessionStore {
  constructor(private db: D1DatabaseLike) {}

  async create(username: string, role: Role, options: { mfaVerified?: boolean } = {}): Promise<SessionRecord> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const record: SessionRecord = {
      token,
      username,
      role,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      mfaVerified: Boolean(options.mfaVerified),
    };

    await this.db
      .prepare("INSERT INTO sessions (token, username, role, created_at, expires_at, mfa_verified) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(tokenHash, record.username, record.role, record.createdAt, record.expiresAt, record.mfaVerified ? 1 : 0)
      .run();

    return record;
  }

  async get(token: string): Promise<SessionRecord | null> {
    const tokenHash = hashOpaqueToken(token);
    const row = await this.db
      .prepare("SELECT token, username, role, created_at, expires_at, mfa_verified FROM sessions WHERE token = ?")
      .bind(tokenHash)
      .first<{ token: string; username: string; role: Role; created_at: string; expires_at: string; mfa_verified: number }>();

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
      mfaVerified: Boolean(row.mfa_verified),
    };
  }

  async destroy(token: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token = ?").bind(hashOpaqueToken(token)).run();
  }

  async destroyAllForUser(username: string): Promise<number> {
    const result = (await this.db.prepare("DELETE FROM sessions WHERE username = ?").bind(username).run()) as
      | { meta?: { changes?: number } }
      | undefined;
    return Number(result?.meta?.changes ?? 0);
  }
}
