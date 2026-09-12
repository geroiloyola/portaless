// Persistencia real de usuarios sobre Cloudflare D1 -- disponible cuando
// el sitio corre en Cloudflare Pages/Workers con un binding "DB" (ver
// wrangler.toml). Usa el mismo esquema que stores/schema.sql.

import type { UserRecord, Role } from "../types";
import type { UsersStore } from "../users-store";
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

export class D1UsersStore implements UsersStore {
  constructor(private db: D1DatabaseLike) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare("SELECT username, password_hash, role, created_at FROM users WHERE username = ?")
      .bind(username)
      .first<{ username: string; password_hash: string; role: Role; created_at: string }>();

    if (!row) return null;
    return {
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
    };
  }

  async createUser(username: string, plainPassword: string, role: Role): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
    };

    await this.db
      .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .bind(record.username, record.passwordHash, record.role, record.createdAt)
      .run();

    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    const { results } = await this.db
      .prepare("SELECT username, password_hash, role, created_at FROM users")
      .bind()
      .all<{ username: string; password_hash: string; role: Role; created_at: string }>();

    return results.map((row) => ({
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
    }));
  }
}
