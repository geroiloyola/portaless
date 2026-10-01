// Challenges MFA y rate limits sobre SQLite (self-host), mismo patron que
// sqlite-password-reset-store.ts: better-sqlite3 via openSqlite(), tablas
// creadas en el constructor, operaciones criticas atomicas en una sola
// sentencia (UPDATE/DELETE ... RETURNING).
//
// Uso: const store = await SqliteMfaChallengeStore.open(path);

import type { Role } from "../types";
import type { MfaChallengeRecord, MfaChallengeStore, RateLimitStore } from "../ephemeral-auth-store";
import { MFA_CHALLENGES_DDL, RATE_LIMITS_DDL } from "./d1-ephemeral-auth-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

type ChallengeRow = { username: string; role: Role; expires_at: number; failed_attempts: number };

function toRecord(row: ChallengeRow): MfaChallengeRecord {
  return {
    username: row.username,
    role: row.role,
    expiresAt: Number(row.expires_at),
    failedAttempts: Number(row.failed_attempts),
  };
}

function rejectPath(db: unknown, name: string) {
  if (typeof db === "string") {
    throw new Error(`${name} no acepta una ruta en el constructor. Usa: await ${name}.open(path)`);
  }
}

export class SqliteMfaChallengeStore implements MfaChallengeStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteMfaChallengeStore> {
    return new SqliteMfaChallengeStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    rejectPath(db, "SqliteMfaChallengeStore");
    this.db = db;
    this.db.exec(MFA_CHALLENGES_DDL);
  }

  async create(token: string, record: { username: string; role: Role; expiresAt: number }): Promise<void> {
    this.db.prepare("DELETE FROM auth_mfa_challenges WHERE expires_at <= ?").run(Date.now());
    this.db
      .prepare("INSERT INTO auth_mfa_challenges (token, username, role, expires_at, failed_attempts) VALUES (?, ?, ?, ?, 0)")
      .run(token, record.username, record.role, record.expiresAt);
  }

  async get(token: string, now: number): Promise<MfaChallengeRecord | null> {
    const row = this.db
      .prepare("SELECT username, role, expires_at, failed_attempts FROM auth_mfa_challenges WHERE token = ? AND expires_at > ?")
      .get(token, now) as ChallengeRow | undefined;
    return row ? toRecord(row) : null;
  }

  async recordFailure(token: string, now: number): Promise<number | null> {
    const row = this.db
      .prepare("UPDATE auth_mfa_challenges SET failed_attempts = failed_attempts + 1 WHERE token = ? AND expires_at > ? RETURNING failed_attempts")
      .get(token, now) as { failed_attempts: number } | undefined;
    return row ? Number(row.failed_attempts) : null;
  }

  async consume(token: string, now: number, maxAttempts: number): Promise<MfaChallengeRecord | null> {
    const row = this.db
      .prepare("DELETE FROM auth_mfa_challenges WHERE token = ? AND expires_at > ? AND failed_attempts < ? RETURNING username, role, expires_at, failed_attempts")
      .get(token, now, maxAttempts) as ChallengeRow | undefined;
    return row ? toRecord(row) : null;
  }

  async delete(token: string): Promise<void> {
    this.db.prepare("DELETE FROM auth_mfa_challenges WHERE token = ?").run(token);
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteRateLimitStore implements RateLimitStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteRateLimitStore> {
    return new SqliteRateLimitStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    rejectPath(db, "SqliteRateLimitStore");
    this.db = db;
    this.db.exec(RATE_LIMITS_DDL);
  }

  async hit(bucket: string, windowStart: number): Promise<number> {
    this.db.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?").run(windowStart);
    const row = this.db
      .prepare(
        "INSERT INTO auth_rate_limits (bucket, window_start, count) VALUES (?, ?, 1) " +
          "ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count"
      )
      .get(bucket, windowStart) as { count: number } | undefined;
    return row ? Number(row.count) : 1;
  }

  close(): void {
    this.db.close();
  }
}
