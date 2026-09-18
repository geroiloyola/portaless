// Persistencia real de SiteTrustScore sobre Cloudflare D1 -- v0.0.9.19.
// Mismo patron que D1PermissionStore (packages/permissions/src/stores/
// d1-permission-store.ts) y D1PluginRegistryStore: implementa el contrato
// SiteTrustScoreStore usando D1DatabaseLike (interfaz minima compartida,
// no importa el binding real de Cloudflare para evitar acoplar este
// paquete al runtime de Workers).
//
// 4 metodos de escritura, uno por fuente (mismo split que el schema, ver
// docs/architecture/site-trust-score.md): cada INSERT ON CONFLICT usa la
// PRIMARY KEY exacta de su tabla en schema.sql. `getSnapshot` corre las 4
// lecturas en paralelo via Promise.all -- son independientes entre si.
//
// v0.0.9.19: recordCommunityVote persiste ip_hash (SHA-256(ip + salt),
// nunca la IP cruda). isRateLimited() consulta la MISMA tabla de votos --
// no es un store ni un write separado, es un SELECT 1 con
// idx_site_trust_community_rate_limit (site_id, category, ip_hash,
// voted_at) para evitar table scan a medida que la tabla crece.

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

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

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

// Garantiza la fila en site_trust_subjects antes de escribir en cualquier
// tabla de fuente -- las 4 tablas de fuente tienen REFERENCES site_id, y
// D1/SQLite no siempre fuerza foreign keys por defecto, asi que este
// upsert es la unica garantia real de integridad referencial aqui.
async function ensureSubject(db: D1DatabaseLike, siteId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_trust_subjects (site_id, first_seen_at, last_updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET last_updated_at = excluded.last_updated_at`
    )
    .bind(siteId, now, now)
    .run();
}

export class D1SiteTrustScoreStore implements SiteTrustScoreStore {
  constructor(private db: D1DatabaseLike) {}

  async getSnapshot(siteId: string): Promise<SiteTrustSnapshot> {
    const [selfRes, agentRes, communityRes, escrowRes] = await Promise.all([
      this.db.prepare("SELECT * FROM site_trust_self_evaluations WHERE site_id = ?").bind(siteId).all<SelfRow>(),
      this.db.prepare("SELECT * FROM site_trust_agent_verifications WHERE site_id = ?").bind(siteId).all<AgentRow>(),
      this.db.prepare("SELECT * FROM site_trust_community_votes WHERE site_id = ?").bind(siteId).all<CommunityRow>(),
      this.db.prepare("SELECT * FROM site_trust_escrow_reports WHERE site_id = ?").bind(siteId).all<EscrowRow>(),
    ]);

    return {
      siteId,
      self: selfRes.results.map(rowToSelf),
      agent: agentRes.results.map(rowToAgent),
      community: communityRes.results.map(rowToCommunity),
      escrowReports: escrowRes.results.map(rowToEscrow),
    };
  }

  async recordSelfEvaluation(evaluation: SelfTrustEvaluation): Promise<void> {
    await ensureSubject(this.db, evaluation.siteId);
    await this.db
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
      .bind(
        evaluation.siteId,
        evaluation.category,
        evaluation.declaredValue ? 1 : 0,
        evaluation.evidenceUrl ?? null,
        evaluation.declaredBy,
        evaluation.declaredAt
      )
      .run();
  }

  async recordAgentVerification(verification: AgentTrustVerification): Promise<void> {
    await ensureSubject(this.db, verification.siteId);
    // Sin ON CONFLICT: cada verificacion es un registro historico nuevo
    // (la PK incluye verified_at), a diferencia de self/community que
    // sobrescriben el valor mas reciente por categoria/votante.
    await this.db
      .prepare(
        `INSERT INTO site_trust_agent_verifications
           (site_id, category, verified, detail_json, agent_key_id, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        verification.siteId,
        verification.category,
        verification.verified ? 1 : 0,
        verification.detail ? JSON.stringify(verification.detail) : null,
        verification.agentKeyId,
        verification.verifiedAt
      )
      .run();
  }

  async recordCommunityVote(vote: CommunityTrustVote): Promise<CommunityTrustVote> {
    await ensureSubject(this.db, vote.siteId);
    await this.db
      .prepare(
        `INSERT INTO site_trust_community_votes
           (site_id, category, score, comment, voter_id, ip_hash, voted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, category, voter_id)
         DO UPDATE SET score = excluded.score, comment = excluded.comment,
                       ip_hash = excluded.ip_hash, voted_at = excluded.voted_at`
      )
      .bind(vote.siteId, vote.category, vote.score, vote.comment ?? null, vote.voterId, vote.ipHash, vote.votedAt)
      .run();
    return vote;
  }

  async recordEscrowReport(report: EscrowTrustReport): Promise<void> {
    await ensureSubject(this.db, report.siteId);
    await this.db
      .prepare(
        `INSERT INTO site_trust_escrow_reports
           (site_id, transaction_outcome, escrow_provider, amount_currency, reported_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(report.siteId, report.transactionOutcome, report.escrowProvider, report.amountCurrency ?? null, report.reportedAt)
      .run();
  }

  async isRateLimited(
    siteId: string,
    category: CommunityTrustCategory,
    ipHash: string,
    windowMs = 24 * 60 * 60 * 1000
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const row = await this.db
      .prepare(
        `SELECT 1 as hit FROM site_trust_community_votes
         WHERE site_id = ? AND category = ? AND ip_hash = ? AND voted_at > ?
         LIMIT 1`
      )
      .bind(siteId, category, ipHash, cutoff)
      .first<{ hit: number }>();
    return row !== null;
  }
}
