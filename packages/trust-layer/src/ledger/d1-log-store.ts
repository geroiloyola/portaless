// Persistencia real del ledger sobre Cloudflare D1.
//
// ERRATA E-9: columna reader_did. D1 no permite migrar en el constructor
// (es async), asi que la primera operacion de cada instancia intenta
// ALTER TABLE ADD COLUMN y, si la columna ya existe, ignora el error.
import type { UsageLogPeriod, AgentUsageEntry } from "./log-schema";
import type { UsageLedgerStore } from "./log-writer";
import { UPSERT_USAGE_SQL, usageRowArgs } from "./sqlite-log-store";

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

export class D1UsageLedgerStore implements UsageLedgerStore {
  private migrated: Promise<void> | null = null;

  constructor(private db: D1DatabaseLike) {}

  private ensureReaderDidColumn(): Promise<void> {
    if (!this.migrated) {
      this.migrated = this.db
        .prepare("ALTER TABLE usage_ledger ADD COLUMN reader_did TEXT")
        .bind()
        .run()
        .then(
          () => undefined,
          (err: unknown) => {
            if (!/duplicate column/i.test(String((err as Error)?.message ?? err))) {
              this.migrated = null;
              throw err;
            }
          }
        );
    }
    return this.migrated;
  }

  async get(period: string): Promise<UsageLogPeriod | null> {
    await this.ensureReaderDidColumn();
    const { results } = await this.db.prepare("SELECT * FROM usage_ledger WHERE period = ?").bind(period).all<RowType>();
    if (results.length === 0) return null;
    return { period, generatedAt: new Date().toISOString(), agents: results.map(rowToEntry) };
  }

  async put(period: string, data: UsageLogPeriod): Promise<void> {
    await this.ensureReaderDidColumn();
    for (const agent of data.agents) {
      await this.db.prepare(UPSERT_USAGE_SQL).bind(...usageRowArgs(period, agent)).run();
    }
  }
}
