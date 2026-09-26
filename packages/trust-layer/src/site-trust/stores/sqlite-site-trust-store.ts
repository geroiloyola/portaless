// Persistencia real de SiteTrustScore para self-hosted -- v0.0.9.19. Mismo
// patron que SqlitePermissionStore: crea las tablas via CREATE TABLE IF NOT
// EXISTS (idempotente frente a alguien que ya corrio schema.sql a mano) y
// expone la misma API sincrona-envuelta-en-Promise que D1SiteTrustScoreStore
// para que ambos backends sean intercambiables detras de SiteTrustScoreStore.
//
// v0.0.9.19: recordCommunityVote persiste ip_hash (SHA-256(ip + salt),
// nunca la IP cruda). isRateLimited() consulta la MISMA tabla de votos.
//
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(). Uso: await SqliteSiteTrustScoreStore.open(path).

import type {
  SiteTrustScoreStore,
  SiteTrustSnapshot,
  SelfTrustEvaluation,
  SelfTrustCategory,
  AgentTrustVerification,
  AgentTrustCategory,
  CommunityTrustVote,
  CommunityTrustCategory,
  EscrowTrustReport,
  EscrowTransactionOutcome,
} from "../site-trust-score";
import { openSqlite } from "../../../../sqlite-driver/src/open";

interface SelfRow {
  site_id: string;
  category: string;
  declared_value: number;
  evidence_url: string | null;
  declared_by: string;
  declared_at: string;
}

interface AgentRow {
  site_id: string;
  category: string;
  verified: number;
  detail_json: string | null;
  agent_key_id: string;
  verified_at: string;
}

interface CommunityRow {
  site_id: string;
  category: string;
  score: number;
  comment: string | null;
  voter_id: string;
  ip_hash: string;
  voted_at: string;
}

interface EscrowRow {
  site_id: string;
  transaction_outcome: string;
  escrow_provider: string;
  amount_currency: string | null;
  reported_at: string;
}

function rowToSelf(row: SelfRow): SelfTrustEvaluation {
  return {
    siteId: row.site_id,
    category: row.category as SelfTrustCategory,
    declaredValue: row.declared_value === 1,
    evidenceUrl: row.evidence_url ?? undefined,
    declaredBy: row.declared_by,
    declaredAt: row.declared_at,
  };
}

function rowToAgent(row: AgentRow): AgentTrustVerification {
  return {
    siteId: row.site_id,
    category: row.category as AgentTrustCategory,
    verified: row.verified === 1,
    detail: row.detail_json ? JSON.parse(row.detail_json) : undefined,
    agentKeyId: row.agent_key_id,
    verifiedAt: row.verified_at,
  };
}

function rowToCommunity(row: CommunityRow): CommunityTrustVote {
  return {
    siteId: row.site_id,
    category: row.category as CommunityTrustCategory,
    score: row.score as 1 | 2 | 3 | 4 | 5,
    comment: row.comment ?? undefined,
    voterId: row.voter_id,
    ipHash: row.ip_hash,
    votedAt: row.voted_at,
  };
}

function rowToEscrow(row: EscrowRow): EscrowTrustReport {
  return {
    siteId: row.site_id,
    transactionOutcome: row.transaction_outcome as EscrowTransactionOutcome,
    escrowProvider: row.escrow_provider,
    amountCurrency: row.amount_currency ?? undefined,
    reportedAt: row.reported_at,
  };
}

export class SqliteSiteTrustScoreStore implements SiteTrustScoreStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteSiteTrustScoreStore> {
    return new SqliteSiteTrustScoreStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteSiteTrustScoreStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqliteSiteTrustScoreStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_trust_subjects (
        site_id TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS site_trust_self_evaluations (
        site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
        category TEXT NOT NULL,
        declared_value INTEGER NOT NULL,
        evidence_url TEXT,
        declared_by TEXT NOT NULL,
        declared_at TEXT NOT NULL,
        PRIMARY KEY (site_id, category)
      );
      CREATE TABLE IF NOT EXISTS site_trust_agent_verifications (
        site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
        category TEXT NOT NULL,
        verified INTEGER NOT NULL,
        detail_json TEXT,
        agent_key_id TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        PRIMARY KEY (site_id, category, agent_key_id, verified_at)
      );
      CREATE TABLE IF NOT EXISTS site_trust_community_votes (
        site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
        category TEXT NOT NULL,
        score INTEGER NOT NULL,
        comment TEXT,
        voter_id TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        voted_at TEXT NOT NULL,
        PRIMARY KEY (site_id, category, voter_id)
      );
      CREATE INDEX IF NOT EXISTS idx_site_trust_community_rate_limit
        ON site_trust_community_votes(site_id, category, ip_hash, voted_at);
      CREATE TABLE IF NOT EXISTS site_trust_escrow_reports (
        site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
        transaction_outcome TEXT NOT NULL,
        escrow_provider TEXT NOT NULL,
        amount_currency TEXT,
        reported_at TEXT NOT NULL,
        PRIMARY KEY (site_id, escrow_provider, reported_at)
      );
    `);
  }

  private ensureSubject(siteId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO site_trust_subjects (site_id, first_seen_at, last_updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET last_updated_at = excluded.last_updated_at`
      )
      .run(siteId, now, now);
  }

  async getSnapshot(siteId: string): Promise<SiteTrustSnapshot> {
    const self = this.db
      .prepare("SELECT * FROM site_trust_self_evaluations WHERE site_id = ?")
      .all(siteId) as SelfRow[];
    const agent = this.db
      .prepare("SELECT * FROM site_trust_agent_verifications WHERE site_id = ?")
      .all(siteId) as AgentRow[];
    const community = this.db
      .prepare("SELECT * FROM site_trust_community_votes WHERE site_id = ?")
      .all(siteId) as CommunityRow[];
    const escrow = this.db
      .prepare("SELECT * FROM site_trust_escrow_reports WHERE site_id = ?")
      .all(siteId) as EscrowRow[];

    return {
      siteId,
      self: self.map(rowToSelf),
      agent: agent.map(rowToAgent),
      community: community.map(rowToCommunity),
      escrowReports: escrow.map(rowToEscrow),
    };
  }

  async recordSelfEvaluation(evaluation: SelfTrustEvaluation): Promise<void> {
    this.ensureSubject(evaluation.siteId);
    this.db
      .prepare(
        `INSERT INTO site_trust_self_evaluations
           (site_id, category, declared_value, evidence_url, declared_by, declared_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, category)
         DO UPDATE SET declared_value = excluded.declared_value,
                       evidence_url = excluded.evidence_url,
                       declared_by = excluded.declared_by,
                       declared_at = excluded.declared_at`
      )
      .run(
        evaluation.siteId,
        evaluation.category,
        evaluation.declaredValue ? 1 : 0,
        evaluation.evidenceUrl ?? null,
        evaluation.declaredBy,
        evaluation.declaredAt
      );
  }

  async recordAgentVerification(verification: AgentTrustVerification): Promise<void> {
    this.ensureSubject(verification.siteId);
    this.db
      .prepare(
        `INSERT INTO site_trust_agent_verifications
           (site_id, category, verified, detail_json, agent_key_id, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        verification.siteId,
        verification.category,
        verification.verified ? 1 : 0,
        verification.detail ? JSON.stringify(verification.detail) : null,
        verification.agentKeyId,
        verification.verifiedAt
      );
  }

  async recordCommunityVote(vote: CommunityTrustVote): Promise<CommunityTrustVote> {
    this.ensureSubject(vote.siteId);
    this.db
      .prepare(
        `INSERT INTO site_trust_community_votes
           (site_id, category, score, comment, voter_id, ip_hash, voted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, category, voter_id)
         DO UPDATE SET score = excluded.score, comment = excluded.comment,
                       ip_hash = excluded.ip_hash, voted_at = excluded.voted_at`
      )
      .run(vote.siteId, vote.category, vote.score, vote.comment ?? null, vote.voterId, vote.ipHash, vote.votedAt);
    return vote;
  }

  async recordEscrowReport(report: EscrowTrustReport): Promise<void> {
    this.ensureSubject(report.siteId);
    this.db
      .prepare(
        `INSERT INTO site_trust_escrow_reports
           (site_id, transaction_outcome, escrow_provider, amount_currency, reported_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(report.siteId, report.transactionOutcome, report.escrowProvider, report.amountCurrency ?? null, report.reportedAt);
  }

  async isRateLimited(
    siteId: string,
    category: CommunityTrustCategory,
    ipHash: string,
    windowMs = 24 * 60 * 60 * 1000
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const row = this.db
      .prepare(
        `SELECT 1 as hit FROM site_trust_community_votes
         WHERE site_id = ? AND category = ? AND ip_hash = ? AND voted_at > ?
         LIMIT 1`
      )
      .get(siteId, category, ipHash, cutoff);
    return row !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
