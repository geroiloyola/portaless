// Persistencia real de tokens de recuperacion de contrasena sobre
// Cloudflare D1 -- mismo patron que d1-users-store.ts y d1-session-store.ts
// del PR #4 original. Antes de este commit, createPasswordResetStore()
// siempre devolvia InMemoryPasswordResetStore sin importar el backend
// configurado -- los tokens de recuperacion pendientes se perdian si el
// proceso/Worker reiniciaba antes de que el usuario completara el flujo.

import { randomBytes } from "node:crypto";
import type { PasswordResetRequest } from "../types";
import type { PasswordResetStore } from "../password-reset-store";
import type { D1DatabaseLike } from "./d1-users-store";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos -- mismo TTL que InMemoryPasswordResetStore.

export class D1PasswordResetStore implements PasswordResetStore {
  constructor(private db: D1DatabaseLike) {}

  async create(username: string): Promise<PasswordResetRequest> {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const record: PasswordResetRequest = {
      token,
      username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    };

    await this.db
      .prepare(
        "INSERT INTO password_reset_requests (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(record.token, record.username, record.createdAt, record.expiresAt)
      .run();

    return record;
  }

  async consume(token: string): Promise<PasswordResetRequest | null> {
    const row = await this.db
      .prepare(
        "SELECT token, username, created_at, expires_at, used_at FROM password_reset_requests WHERE token = ?"
      )
      .bind(token)
      .first<{ token: string; username: string; created_at: string; expires_at: string; used_at: string | null }>();

    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db.prepare("DELETE FROM password_reset_requests WHERE token = ?").bind(token).run();
      return null;
    }

    const usedAt = new Date().toISOString();
    await this.db
      .prepare("UPDATE password_reset_requests SET used_at = ? WHERE token = ?")
      .bind(usedAt, token)
      .run();

    return {
      token: row.token,
      username: row.username,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt,
    };
  }

  async invalidateAllForUser(username: string): Promise<void> {
    await this.db.prepare("DELETE FROM password_reset_requests WHERE username = ?").bind(username).run();
  }
}
