// Persistencia real del ledger para self-hosted.
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(). Uso: await SqliteUsageLedgerStore.open(path).
import type { UsageLogPeriod, AgentUsageEntry } from "./log-schema";
import type { UsageLedgerStore } from "./log-writer";
import { openSqlite } from "../../../sqlite-driver/src/open";

interface RowType {
  period: string; operator_key_id: string; operator_name_claimed: string | null;
  requests_total: number; requests_charged: number; requests_free_tier: number;
  revenue_usd: number; policy_violations_detected: number; first_seen: string; last_seen: string;
}

function rowToEntry(row: RowType): AgentUsageEntry {
  return {
    operatorKeyId: row.operator_key_id, operatorNameClaimed: row.operator_name_claimed ?? undefined,
    requestsTotal: row.requests_total, requestsCharged: row.requests_charged,
    requestsFreeTier: row.requests_free_tier, revenueUsd: row.revenue_usd,
    policyViolationsDetected: row.policy_violations_detected, firstSeen: row.first_seen, lastSeen: row.last_seen,
  };
}

export class SqliteUsageLedgerStore implements UsageLedgerStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteUsageLedgerStore> {
    return new SqliteUsageLedgerStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteUsageLedgerStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqliteUsageLedgerStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS usage_ledger (
      period TEXT NOT NULL, operator_key_id TEXT NOT NULL, operator_name_claimed TEXT,
      requests_total INTEGER NOT NULL DEFAULT 0, requests_charged INTEGER NOT NULL DEFAULT 0,
      requests_free_tier INTEGER NOT NULL DEFAULT 0, revenue_usd REAL NOT NULL DEFAULT 0,
      policy_violations_detected INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      PRIMARY KEY (period, operator_key_id));`);
  }

  async get(period: string): Promise<UsageLogPeriod | null> {
    const rows = this.db.prepare("SELECT * FROM usage_ledger WHERE period = ?").all(period) as RowType[];
    if (rows.length === 0) return null;
    return { period, generatedAt: new Date().toISOString(), agents: rows.map(rowToEntry) };
  }

  async put(period: string, data: UsageLogPeriod): Promise<void> {
    for (const agent of data.agents) {
      this.db.prepare(
        `INSERT INTO usage_ledger (period, operator_key_id, operator_name_claimed, requests_total, requests_charged,
          requests_free_tier, revenue_usd, policy_violations_detected, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(period, operator_key_id) DO UPDATE SET
           requests_total = excluded.requests_total, requests_charged = excluded.requests_charged,
           requests_free_tier = excluded.requests_free_tier, revenue_usd = excluded.revenue_usd,
           policy_violations_detected = excluded.policy_violations_detected, last_seen = excluded.last_seen`
      ).run(period, agent.operatorKeyId, agent.operatorNameClaimed ?? null, agent.requestsTotal,
        agent.requestsCharged, agent.requestsFreeTier, agent.revenueUsd, agent.policyViolationsDetected,
        agent.firstSeen, agent.lastSeen);
    }
  }

  close(): void {
    this.db.close();
  }
}
