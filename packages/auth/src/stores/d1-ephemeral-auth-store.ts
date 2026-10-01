// Challenges MFA y rate limits sobre Cloudflare D1. Las tablas se crean con
// CREATE TABLE IF NOT EXISTS la primera vez que cada instancia las usa, asi
// funciona tambien en bases D1 creadas antes de este cambio sin correr
// `wrangler d1 execute` a mano. RETURNING requiere SQLite 3.35+, que D1 ya
// soporta.

import type { Role } from "../types";
import type { MfaChallengeRecord, MfaChallengeStore, RateLimitStore } from "../ephemeral-auth-store";
import type { D1DatabaseLike } from "./d1-users-store";

export const MFA_CHALLENGES_DDL =
  "CREATE TABLE IF NOT EXISTS auth_mfa_challenges (" +
  "token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, " +
  "expires_at INTEGER NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0)";

export const RATE_LIMITS_DDL =
  "CREATE TABLE IF NOT EXISTS auth_rate_limits (" +
  "bucket TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, " +
  "PRIMARY KEY (bucket, window_start))";

type ChallengeRow = { username: string; role: Role; expires_at: number; failed_attempts: number };

function toRecord(row: ChallengeRow): MfaChallengeRecord {
  return {
    username: row.username,
    role: row.role,
    expiresAt: Number(row.expires_at),
    failedAttempts: Number(row.failed_attempts),
  };
}

export class D1MfaChallengeStore implements MfaChallengeStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1DatabaseLike) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(MFA_CHALLENGES_DDL).bind().run());
  }

  async create(token: string, record: { username: string; role: Role; expiresAt: number }): Promise<void> {
    await this.ensure();
    await this.db.prepare("DELETE FROM auth_mfa_challenges WHERE expires_at <= ?").bind(Date.now()).run();
    await this.db
      .prepare("INSERT INTO auth_mfa_challenges (token, username, role, expires_at, failed_attempts) VALUES (?, ?, ?, ?, 0)")
      .bind(token, record.username, record.role, record.expiresAt)
      .run();
  }

  async get(token: string, now: number): Promise<MfaChallengeRecord | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT username, role, expires_at, failed_attempts FROM auth_mfa_challenges WHERE token = ? AND expires_at > ?")
      .bind(token, now)
      .first<ChallengeRow>();
    return row ? toRecord(row) : null;
  }

  async recordFailure(token: string, now: number): Promise<number | null> {
    await this.ensure();
    const row = await this.db
      .prepare("UPDATE auth_mfa_challenges SET failed_attempts = failed_attempts + 1 WHERE token = ? AND expires_at > ? RETURNING failed_attempts")
      .bind(token, now)
      .first<{ failed_attempts: number }>();
    return row ? Number(row.failed_attempts) : null;
  }

  async consume(token: string, now: number, maxAttempts: number): Promise<MfaChallengeRecord | null> {
    await this.ensure();
    const row = await this.db
      .prepare("DELETE FROM auth_mfa_challenges WHERE token = ? AND expires_at > ? AND failed_attempts < ? RETURNING username, role, expires_at, failed_attempts")
      .bind(token, now, maxAttempts)
      .first<ChallengeRow>();
    return row ? toRecord(row) : null;
  }

  async delete(token: string): Promise<void> {
    await this.ensure();
    await this.db.prepare("DELETE FROM auth_mfa_challenges WHERE token = ?").bind(token).run();
  }
}

export class D1RateLimitStore implements RateLimitStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1DatabaseLike) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(RATE_LIMITS_DDL).bind().run());
  }

  async hit(bucket: string, windowStart: number): Promise<number> {
    await this.ensure();
    await this.db.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?").bind(windowStart).run();
    const row = await this.db
      .prepare(
        "INSERT INTO auth_rate_limits (bucket, window_start, count) VALUES (?, ?, 1) " +
          "ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count"
      )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    return row ? Number(row.count) : 1;
  }
}
