// Portaless node SQLite/D1 storage adapters for agent access policy (Node-L0).
import { openSqlite } from "@portaless/sqlite-driver";
import type { ContentPolicyManifest } from "@verared/trust-layer/policy";
import {
  AGENT_ACCESS_POLICY_DDL,
  INVALID_AGENT_ACCESS_POLICY,
  InMemoryAgentAccessPolicyStore,
  sanitizePolicy,
  validateAgentAccessPolicy,
  type AgentAccessPolicyRecord,
  type AgentAccessPolicyStore,
} from "@verared/trust-layer/policy";

const READ_SQL = "SELECT policy_json, updated_at, updated_by FROM agent_access_policy WHERE id = 1";
const UPSERT_SQL = `INSERT INTO agent_access_policy (id, policy_json, updated_at, updated_by)
  VALUES (1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    policy_json = excluded.policy_json,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by`;

function recordFromRow(row: { policy_json: string; updated_at: string; updated_by: string }): AgentAccessPolicyRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.policy_json);
  } catch {
    console.warn("[Portaless AgentAccess] policy_json no es JSON: se ignora el override y se usa el asset/default.");
    return null;
  }
  if (!validateAgentAccessPolicy(parsed)) {
    console.warn("[Portaless AgentAccess] override guardado invalido: se ignora y se usa el asset/default.");
    return null;
  }
  return { policy: parsed, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export class SqlAgentAccessPolicyStore implements AgentAccessPolicyStore {
  private db: any;

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqlAgentAccessPolicyStore no acepta una ruta: usa SqlAgentAccessPolicyStore.open(path)",
      );
    }
    this.db = db;
    this.db.exec(AGENT_ACCESS_POLICY_DDL);
  }

  static async open(dbPath: string): Promise<SqlAgentAccessPolicyStore> {
    return new SqlAgentAccessPolicyStore(await openSqlite(dbPath));
  }

  async read(): Promise<AgentAccessPolicyRecord | null> {
    const row = this.db.prepare(READ_SQL).get();
    return row === undefined ? null : recordFromRow(row);
  }

  async write(policy: ContentPolicyManifest, updatedBy: string): Promise<AgentAccessPolicyRecord> {
    if (!validateAgentAccessPolicy(policy)) throw new Error(INVALID_AGENT_ACCESS_POLICY);
    const updatedAt = new Date().toISOString();
    const clean = sanitizePolicy(policy, policy.site);
    this.db.prepare(UPSERT_SQL).run(JSON.stringify(clean), updatedAt, updatedBy);
    return { policy: clean, updatedAt, updatedBy };
  }

  async clear(): Promise<void> {
    this.db.prepare("DELETE FROM agent_access_policy WHERE id = 1").run();
  }

  close(): void {
    this.db.close();
  }
}

export interface AgentAccessPolicyFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createAgentAccessPolicyStore(
  env: AgentAccessPolicyFactoryEnv,
): Promise<AgentAccessPolicyStore> {
  if (env?.DB) return new SqlAgentAccessPolicyStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) return SqlAgentAccessPolicyStore.open(env.PORTALESS_SQLITE_PATH);
  console.warn(
    "[Portaless AgentAccess] Sin DB ni PORTALESS_SQLITE_PATH. Override de politica en memoria (se pierde al reiniciar).",
  );
  return new InMemoryAgentAccessPolicyStore();
}
