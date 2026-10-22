import { openSqlite } from "../../../sqlite-driver/src/open";

export interface ResolutionBudgetConfiguration {
  version: 1;
  windowMs: number;
  client: { attempts: number; bytes: number };
  origin: { attempts: number; bytes: number };
  maxBuckets: number;
  maxConcurrentTotal: number;
  maxConcurrentPerClient: number;
  maxConcurrentPerOrigin: number;
}

export interface ResolutionBudgetConfigRecord {
  config: ResolutionBudgetConfiguration;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export const INVALID_RESOLUTION_BUDGET_CONFIG = "invalid_resolution_budget_config";
export const RESOLUTION_BUDGET_CONFIG_CONFLICT = "resolution_budget_config_conflict";

const SELECT = "SELECT config_json, revision, updated_at, updated_by FROM resolution_budget_config WHERE id = 1";
const INSERT = "INSERT INTO resolution_budget_config (id, config_json, revision, updated_at, updated_by) VALUES (1, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING";
const UPDATE = "UPDATE resolution_budget_config SET config_json = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?";

function int(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function validateResolutionBudgetConfiguration(value: unknown): value is ResolutionBudgetConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, any>;
  const keys = ["version", "windowMs", "client", "origin", "maxBuckets", "maxConcurrentTotal", "maxConcurrentPerClient", "maxConcurrentPerOrigin"];
  if (Object.keys(config).some((key) => !keys.includes(key)) || keys.some((key) => !(key in config))) return false;
  if (config.version !== 1 || !int(config.windowMs, 1000, 3_600_000) || !int(config.maxBuckets, 2, 4096)
    || !int(config.maxConcurrentTotal, 1, 64) || !int(config.maxConcurrentPerClient, 1, 64)
    || !int(config.maxConcurrentPerOrigin, 1, 64)) return false;
  for (const scope of [config.client, config.origin]) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope)
      || Object.keys(scope).some((key) => key !== "attempts" && key !== "bytes")
      || !int(scope.attempts, 1, 100_000) || !int(scope.bytes, 1, 64 * 1024 * 1024)) return false;
  }
  return true;
}

function cleanConfig(config: ResolutionBudgetConfiguration): ResolutionBudgetConfiguration {
  return JSON.parse(JSON.stringify(config));
}

function record(row: any): ResolutionBudgetConfigRecord | null {
  if (!row) return null;
  let config: unknown;
  try { config = JSON.parse(row.config_json); }
  catch { throw new Error("resolution_budget_config_corrupt"); }
  if (!validateResolutionBudgetConfiguration(config) || !int(row.revision, 1, Number.MAX_SAFE_INTEGER)
    || typeof row.updated_at !== "string" || typeof row.updated_by !== "string") {
    throw new Error("resolution_budget_config_corrupt");
  }
  return { config: cleanConfig(config), revision: Number(row.revision), updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export interface ResolutionBudgetConfigStore {
  read(): Promise<ResolutionBudgetConfigRecord | null>;
  compareAndSet(expectedRevision: number | null, config: unknown, updatedBy: string): Promise<ResolutionBudgetConfigRecord>;
  close?(): void;
}

export class SqliteResolutionBudgetConfigStore implements ResolutionBudgetConfigStore {
  constructor(private db: any) { }
  static async open(path: string): Promise<SqliteResolutionBudgetConfigStore> {
    return new SqliteResolutionBudgetConfigStore(await openSqlite(path));
  }
  async read(): Promise<ResolutionBudgetConfigRecord | null> {
    return record(this.db.prepare(SELECT).get());
  }
  async compareAndSet(expectedRevision: number | null, value: unknown, updatedBy: string): Promise<ResolutionBudgetConfigRecord> {
    if (!validateResolutionBudgetConfiguration(value)) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    if (expectedRevision !== null && !int(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    if (typeof updatedBy !== "string" || !updatedBy.trim() || updatedBy.length > 128) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    const now = new Date().toISOString();
    const result = expectedRevision === null
      ? this.db.prepare(INSERT).run(JSON.stringify(cleanConfig(value)), now, updatedBy)
      : this.db.prepare(UPDATE).run(JSON.stringify(cleanConfig(value)), now, updatedBy, expectedRevision);
    if ((result.changes ?? 0) !== 1) throw new Error(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    return { config: cleanConfig(value), revision: expectedRevision === null ? 1 : expectedRevision + 1, updatedAt: now, updatedBy };
  }
  close(): void { this.db.close(); }
}

export class D1ResolutionBudgetConfigStore implements ResolutionBudgetConfigStore {
  constructor(private db: any) {}
  async read(): Promise<ResolutionBudgetConfigRecord | null> {
    return record(await this.db.prepare(SELECT).first());
  }
  async compareAndSet(expectedRevision: number | null, value: unknown, updatedBy: string): Promise<ResolutionBudgetConfigRecord> {
    if (!validateResolutionBudgetConfiguration(value)) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    if (expectedRevision !== null && !int(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    if (typeof updatedBy !== "string" || !updatedBy.trim() || updatedBy.length > 128) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    const now = new Date().toISOString();
    const statement = expectedRevision === null
      ? this.db.prepare(INSERT).bind(JSON.stringify(cleanConfig(value)), now, updatedBy)
      : this.db.prepare(UPDATE).bind(JSON.stringify(cleanConfig(value)), now, updatedBy, expectedRevision);
    const result = await statement.run();
    if ((result.meta?.changes ?? result.changes ?? 0) !== 1) throw new Error(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    return { config: cleanConfig(value), revision: expectedRevision === null ? 1 : expectedRevision + 1, updatedAt: now, updatedBy };
  }
}

export interface ResolutionBudgetConfigFactoryEnv { DB?: any; PORTALESS_SQLITE_PATH?: string }
export async function createResolutionBudgetConfigStore(env: ResolutionBudgetConfigFactoryEnv): Promise<ResolutionBudgetConfigStore> {
  if (env?.DB) return new D1ResolutionBudgetConfigStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) return SqliteResolutionBudgetConfigStore.open(env.PORTALESS_SQLITE_PATH);
  throw new Error("resolution_budget_config_store_unavailable");
}
