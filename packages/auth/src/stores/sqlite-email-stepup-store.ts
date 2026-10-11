// Challenges de step-up por email sobre SQLite (self-host), mismo patron
// que SqliteMfaChallengeStore: better-sqlite3 via openSqlite(), tabla
// creada en el constructor.
//
// Uso: const store = await SqliteEmailStepUpStore.open(path);

import type { EmailStepUpChallenge, EmailStepUpStore } from "../email-stepup-store";
import { EMAIL_STEPUP_DDL } from "./d1-email-stepup-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

type ChallengeRow = { username: string; code_hash: string; expires_at: number; failed_attempts: number };

function toRecord(row: ChallengeRow): EmailStepUpChallenge {
  return {
    username: String(row.username),
    codeHash: String(row.code_hash),
    expiresAt: Number(row.expires_at),
    failedAttempts: Number(row.failed_attempts),
  };
}

function rejectPath(db: unknown, name: string) {
  if (typeof db === "string") {
    throw new Error(`${name} no acepta una ruta en el constructor. Usa: await ${name}.open(path)`);
  }
}

export class SqliteEmailStepUpStore implements EmailStepUpStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteEmailStepUpStore> {
    return new SqliteEmailStepUpStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    rejectPath(db, "SqliteEmailStepUpStore");
    this.db = db;
    this.db.exec(EMAIL_STEPUP_DDL);
  }

  async create(token: string, record: { username: string; codeHash: string; expiresAt: number }): Promise<void> {
    this.db.prepare("DELETE FROM auth_email_stepup_codes WHERE expires_at <= ?").run(Date.now());
    this.db
      .prepare("INSERT INTO auth_email_stepup_codes (token, username, code_hash, expires_at, failed_attempts) VALUES (?, ?, ?, ?, 0)")
      .run(token, record.username, record.codeHash, record.expiresAt);
  }

  async get(token: string, now: number): Promise<EmailStepUpChallenge | null> {
    const row = this.db
      .prepare("SELECT username, code_hash, expires_at, failed_attempts FROM auth_email_stepup_codes WHERE token = ? AND expires_at > ?")
      .get(token, now) as ChallengeRow | undefined;
    return row ? toRecord(row) : null;
  }

  async recordFailure(token: string, now: number): Promise<number | null> {
    const row = this.db
      .prepare("UPDATE auth_email_stepup_codes SET failed_attempts = failed_attempts + 1 WHERE token = ? AND expires_at > ? RETURNING failed_attempts")
      .get(token, now) as { failed_attempts: number } | undefined;
    return row ? Number(row.failed_attempts) : null;
  }

  async consume(token: string, now: number, maxAttempts: number): Promise<EmailStepUpChallenge | null> {
    const row = this.db
      .prepare("DELETE FROM auth_email_stepup_codes WHERE token = ? AND expires_at > ? AND failed_attempts < ? RETURNING username, code_hash, expires_at, failed_attempts")
      .get(token, now, maxAttempts) as ChallengeRow | undefined;
    return row ? toRecord(row) : null;
  }

  async delete(token: string): Promise<void> {
    this.db.prepare("DELETE FROM auth_email_stepup_codes WHERE token = ?").run(token);
  }
}
