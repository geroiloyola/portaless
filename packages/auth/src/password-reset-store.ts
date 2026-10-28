// Almacenamiento de tokens de recuperacion de contrasena (un solo uso,
// vida corta). Mismo principio multi-backend que users-store.ts/
// session-store.ts: implementacion de referencia en memoria + interfaz
// para D1/SQLite via store-factory.ts.

import { randomBytes } from "node:crypto";
import type { PasswordResetRequest } from "./types";
import { hashOpaqueToken } from "./token-hash";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos -- vida corta a proposito.

export interface PasswordResetStore {
  create(username: string): Promise<PasswordResetRequest>;
  consume(token: string): Promise<PasswordResetRequest | null>;
  delete(token: string): Promise<void>;
  invalidateAllForUser(username: string): Promise<void>;
}

export class InMemoryPasswordResetStore implements PasswordResetStore {
  private requests = new Map<string, PasswordResetRequest>();

  async create(username: string): Promise<PasswordResetRequest> {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const record: PasswordResetRequest = {
      token,
      username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    };
    this.requests.set(hashOpaqueToken(token), { ...record, token: hashOpaqueToken(token) });
    return record;
  }

  async consume(token: string): Promise<PasswordResetRequest | null> {
    const tokenHash = hashOpaqueToken(token);
    const record = this.requests.get(tokenHash);
    if (!record) return null;
    if (record.usedAt) return null;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.requests.delete(tokenHash);
      return null;
    }
    record.usedAt = new Date().toISOString();
    return record;
  }

  async invalidateAllForUser(username: string): Promise<void> {
    for (const [token, record] of this.requests.entries()) {
      if (record.username === username) this.requests.delete(token);
    }
  }

  async delete(token: string): Promise<void> {
    this.requests.delete(hashOpaqueToken(token));
  }
}
