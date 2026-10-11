// Challenges de step-up por email sobre Cloudflare D1. Mismo patron que
// D1MfaChallengeStore (d1-ephemeral-auth-store.ts): la tabla se crea con
// CREATE TABLE IF NOT EXISTS la primera vez que cada instancia la usa, asi
// funciona tambien en bases D1 creadas antes de este cambio.

import type { EmailStepUpChallenge, EmailStepUpStore } from "../email-stepup-store";

export const EMAIL_STEPUP_DDL =
  "CREATE TABLE IF NOT EXISTS auth_email_stepup_codes (" +
  "token TEXT PRIMARY KEY, username TEXT NOT NULL, code_hash TEXT NOT NULL, " +
  "expires_at INTEGER NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0)";

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      get(): Promise<Record<string, unknown> | undefined>;
      first(): Promise<Record<string, unknown> | null>;
    };
  };
}

type ChallengeRow = { username: string; code_hash: string; expires_at: number; failed_attempts: number };

function toRecord(row: ChallengeRow): EmailStepUpChallenge {
  return {
    username: String(row.username),
    codeHash: String(row.code_hash),
    expiresAt: Number(row.expires_at),
    failedAttempts: Number(row.failed_attempts),
  };
}

export class D1EmailStepUpStore implements EmailStepUpStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(EMAIL_STEPUP_DDL).bind().run());
  }

  async create(token: string, record: { username: string; codeHash: string; expiresAt: number }): Promise<void> {
    await this.ensure();
    await this.db.prepare("DELETE FROM auth_email_stepup_codes WHERE expires_at <= ?").bind(Date.now()).run();
    await this.db
      .prepare("INSERT INTO auth_email_stepup_codes (token, username, code_hash, expires_at, failed_attempts) VALUES (?, ?, ?, ?, 0)")
      .bind(token, record.username, record.codeHash, record.expiresAt)
      .run();
  }

  async get(token: string, now: number): Promise<EmailStepUpChallenge | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT username, code_hash, expires_at, failed_attempts FROM auth_email_stepup_codes WHERE token = ? AND expires_at > ?")
      .bind(token, now)
      .first<ChallengeRow>();
    return row ? toRecord(row) : null;
  }

  async recordFailure(token: string, now: number): Promise<number | null> {
    await this.ensure();
    const row = await this.db
      .prepare("UPDATE auth_email_stepup_codes SET failed_attempts = failed_attempts + 1 WHERE token = ? AND expires_at > ? RETURNING failed_attempts")
      .bind(token, now)
      .first<{ failed_attempts: number }>();
    return row ? Number(row.failed_attempts) : null;
  }

  async consume(token: string, now: number, maxAttempts: number): Promise<EmailStepUpChallenge | null> {
    await this.ensure();
    const row = await this.db
      .prepare("DELETE FROM auth_email_stepup_codes WHERE token = ? AND expires_at > ? AND failed_attempts < ? RETURNING username, code_hash, expires_at, failed_attempts")
      .bind(token, now, maxAttempts)
      .first<ChallengeRow>();
    return row ? toRecord(row) : null;
  }

  async delete(token: string): Promise<void> {
    await this.ensure();
    await this.db.prepare("DELETE FROM auth_email_stepup_codes WHERE token = ?").bind(token).run();
  }
}
