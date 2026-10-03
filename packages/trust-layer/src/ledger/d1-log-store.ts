// Persistencia real del ledger sobre Cloudflare D1.
//
// ERRATA E-9: columna reader_did, AL FINAL de los parametros (el orden de las
// 10 columnas originales no cambia). D1 no migra en el constructor: si el
// INSERT falla porque la base es anterior y no tiene reader_did, se agrega la
// columna y se reintenta una vez. Sin llamadas extra cuando la columna existe.
import type { UsageLogPeriod, AgentUsageEntry } from "./log-schema";
import type { UsageLedgerStore } from "./log-writer";

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

interface RowType {
  period: string; operator_key_id: string; operator_name_claimed: string | null; reader_did?: string | null;
  requests_total: number; requests_charged: number; requests_free_tier: number;
  revenue_usd: number; policy_violations_detected: number; first_seen: string; last_seen: string;
}

function rowToEntry(row: RowType): AgentUsageEntry {
  return {
    operatorKeyId: row.operator_key_id, operatorNameClaimed: row.operator_name_claimed ?? undefined,
    readerDid: row.reader_did ?? undefined,
    requestsTotal: row.requests_total, requestsCharged: row.requests_charged,
    requestsFreeTier: row.requests_free_tier, revenueUsd: row.revenue_usd,
    policyViolationsDetected: row.policy_violations_detected, firstSeen: row.first_seen, lastSeen: row.last_seen,
  };
}

const UPSERT_SQL = `INSERT INTO usage_ledger (period, operator_key_id, operator_name_claimed, requests_total, requests_charged,
    requests_free_tier, revenue_usd, policy_violations_detected, first_seen, last_seen, reader_did)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(period, operator_key_id) DO UPDATE SET
     requests_total = excluded.requests_total, requests_charged = excluded.requests_charged,
     requests_free_tier = excluded.requests_free_tier, revenue_usd = excluded.revenue_usd,
     policy_violations_detected = excluded.policy_violations_detected, last_seen = excluded.last_seen,
     reader_did = COALESCE(usage_ledger.reader_did, excluded.reader_did)`;

const MISSING_COLUMN_RE = /reader_did/i;

export class D1UsageLedgerStore implements UsageLedgerStore {
  constructor(private db: D1DatabaseLike) {}

  async get(period: string): Promise<UsageLogPeriod | null> {
    const { results } = await this.db.prepare("SELECT * FROM usage_ledger WHERE period = ?").bind(period).all<RowType>();
    if (results.length === 0) return null;
    return { period, generatedAt: new Date().toISOString(), agents: results.map(rowToEntry) };
  }

  private upsert(period: string, agent: AgentUsageEntry): Promise<unknown> {
    return this.db.prepare(UPSERT_SQL).bind(period, agent.operatorKeyId, agent.operatorNameClaimed ?? null, agent.requestsTotal,
      agent.requestsCharged, agent.requestsFreeTier, agent.revenueUsd, agent.policyViolationsDetected,
      agent.firstSeen, agent.lastSeen, agent.readerDid ?? null).run();
  }

  async put(period: string, data: UsageLogPeriod): Promise<void> {
    for (const agent of data.agents) {
      try {
        await this.upsert(period, agent);
      } catch (err) {
        if (!MISSING_COLUMN_RE.test(String((err as Error)?.message ?? err))) throw err;
        await this.db.prepare("ALTER TABLE usage_ledger ADD COLUMN reader_did TEXT").bind().run().catch(() => undefined);
        await this.upsert(period, agent);
      }
    }
  }
}
