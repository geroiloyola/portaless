import { openSqlite } from "../../../sqlite-driver/src/open";
import { MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_NO_DELETE_DDL, MCP_AUDIT_TABLE_DDL } from "../../../persistence-migrations/src/ddl";
import type { AuditLogEntry, AuditLogStore } from "./types";

export { MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_NO_DELETE_DDL, MCP_AUDIT_TABLE_DDL };

const ALL_DDL = [MCP_AUDIT_TABLE_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_NO_DELETE_DDL];

function makeEventId(): string {
  return crypto.randomUUID();
}

function safeLabel(value: string | undefined, pattern: RegExp, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) return null;
  return value;
}

// Whitelist columns at the persistence boundary: callers cannot accidentally
// persist tool inputs, page bodies, authorization headers, or exception text.
function fields(entry: AuditLogEntry) {
  return {
    eventId: makeEventId(),
    timestamp: entry.timestamp,
    agentKeyId: safeLabel(entry.agentKeyId, /^[A-Za-z0-9:_-]+$/, 256) ?? "invalid-agent",
    toolName: safeLabel(entry.toolName, /^[A-Za-z0-9_]+$/, 128) ?? "unknown_tool",
    capabilityId: entry.capabilityId === null ? null : safeLabel(entry.capabilityId, /^[A-Za-z0-9:_-]+$/, 128),
    outcome: entry.outcome,
    errorCode: entry.errorCode === "capability_denied" ? "capability_denied" : entry.errorCode ? "operation_failed" : null,
    subjectId: safeLabel(entry.subjectId, /^[A-Za-z0-9._/-]+$/, 200) && !entry.subjectId?.includes("..") ? entry.subjectId : null,
    revisionId: safeLabel(entry.revisionId, /^[0-9a-f-]{36}$/i, 36),
  };
}

function fromRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    timestamp: String(row.timestamp),
    agentKeyId: String(row.agent_key_id),
    toolName: String(row.tool_name),
    capabilityId: row.capability_id == null ? null : String(row.capability_id),
    outcome: row.outcome as AuditLogEntry["outcome"],
    ...(row.error_code == null ? {} : { errorCode: String(row.error_code) }),
    ...(row.subject_id == null ? {} : { subjectId: String(row.subject_id) }),
    ...(row.revision_id == null ? {} : { revisionId: String(row.revision_id) }),
  };
}

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): Record<string, unknown>[];
  };
}

export class D1McpAuditLogStore implements AuditLogStore {
  private ready?: Promise<void>;
  constructor(private readonly db: D1Like) {}

  private ensure(): Promise<void> {
    return (this.ready ??= (async () => {
      for (const sql of ALL_DDL) await this.db.prepare(sql).bind().run();
    })());
  }

  async append(entry: AuditLogEntry): Promise<void> {
    await this.ensure();
    const e = fields(entry);
    await this.db.prepare(
      "INSERT INTO mcp_audit_events (event_id,timestamp,agent_key_id,tool_name,capability_id,outcome,error_code,subject_id,revision_id) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(e.eventId, e.timestamp, e.agentKeyId, e.toolName, e.capabilityId, e.outcome, e.errorCode, e.subjectId, e.revisionId).run();
  }

  async list(sinceIso?: string): Promise<AuditLogEntry[]> {
    await this.ensure();
    const query = sinceIso
      ? this.db.prepare("SELECT * FROM mcp_audit_events WHERE timestamp >= ? ORDER BY timestamp DESC,event_id DESC").bind(sinceIso)
      : this.db.prepare("SELECT * FROM mcp_audit_events ORDER BY timestamp DESC,event_id DESC").bind();
    const { results } = await query.all<Record<string, unknown>>();
    return results.map(fromRow);
  }
}

export class SqliteMcpAuditLogStore implements AuditLogStore {
  private constructor(private readonly db: SqliteLike) {
    for (const sql of ALL_DDL) db.exec(sql);
  }

  static async open(path: string): Promise<SqliteMcpAuditLogStore> {
    return new SqliteMcpAuditLogStore(await openSqlite(path) as SqliteLike);
  }

  async append(entry: AuditLogEntry): Promise<void> {
    const e = fields(entry);
    this.db.prepare(
      "INSERT INTO mcp_audit_events (event_id,timestamp,agent_key_id,tool_name,capability_id,outcome,error_code,subject_id,revision_id) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(e.eventId, e.timestamp, e.agentKeyId, e.toolName, e.capabilityId, e.outcome, e.errorCode, e.subjectId, e.revisionId);
  }

  async list(sinceIso?: string): Promise<AuditLogEntry[]> {
    const rows = sinceIso
      ? this.db.prepare("SELECT * FROM mcp_audit_events WHERE timestamp >= ? ORDER BY timestamp DESC,event_id DESC").all(sinceIso)
      : this.db.prepare("SELECT * FROM mcp_audit_events ORDER BY timestamp DESC,event_id DESC").all();
    return rows.map(fromRow);
  }
}

export interface McpAuditLogStoreFactoryEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string }

let cachedSqliteStore: SqliteMcpAuditLogStore | null = null;
const cachedD1Stores = new WeakMap<object, AuditLogStore>();

export async function createMcpAuditLogStore(env: McpAuditLogStoreFactoryEnv): Promise<AuditLogStore> {
  if (env.DB) {
    const db = env.DB as object;
    let store = cachedD1Stores.get(db);
    if (!store) {
      store = new D1McpAuditLogStore(env.DB as D1Like);
      cachedD1Stores.set(db, store);
    }
    return store;
  }
  if (!env.PORTALESS_SQLITE_PATH) {
    throw new Error("MCP audit requires env.DB or PORTALESS_SQLITE_PATH; refusing volatile audit storage.");
  }
  if (!cachedSqliteStore) cachedSqliteStore = await SqliteMcpAuditLogStore.open(env.PORTALESS_SQLITE_PATH);
  return cachedSqliteStore;
}

export function __resetMcpAuditLogStoreFactoryForTests(): void {
  cachedSqliteStore = null;
}
