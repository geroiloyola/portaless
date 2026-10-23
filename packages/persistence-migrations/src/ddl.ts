// DDL de tablas que NO tienen un schema.sql de paquete propio.
//
// Vive ACA (y no en el store que la usa) para que exista UNA sola fuente de
// verdad entre:
//   - el store que la ejecuta (CREATE TABLE IF NOT EXISTS al abrir), y
//   - la migracion numerada que la registra en el libro mayor.
// Este modulo es HOJA (no importa nada): puede entrar al bundle de Cloudflare
// Pages Functions (el gate de migraciones importa `index.ts`, que importa esto)
// sin arrastrar better-sqlite3 ni el sandbox.
//
// Regla: el `schema-additions/*.sql` correspondiente es la fuente del maestro
// `schema.sql`; un test de paridad (migrations.test.ts) verifica que el texto
// normalizado coincida con esta constante, asi no pueden divergir.

/**
 * Cuota diaria de email por plugin (capacidad `email:send`). PK compuesta
 * (plugin_id, day) para el contador atomico del rate limit. Espeja
 * schema-additions/plugin-email-quota.sql.
 */
export const PLUGIN_EMAIL_QUOTA_DDL =
  "CREATE TABLE IF NOT EXISTS plugin_email_quota (" +
  "plugin_id TEXT NOT NULL, " +
  "day TEXT NOT NULL, " +
  "count INTEGER NOT NULL DEFAULT 0, " +
  "PRIMARY KEY (plugin_id, day))";

export const MCP_AUDIT_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS mcp_audit_events (" +
  "event_id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, agent_key_id TEXT NOT NULL, " +
  "tool_name TEXT NOT NULL, capability_id TEXT, outcome TEXT NOT NULL, error_code TEXT, " +
  "subject_id TEXT, revision_id TEXT)";
export const MCP_AUDIT_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_mcp_audit_events_timestamp ON mcp_audit_events(timestamp)";
export const MCP_AUDIT_APPEND_ONLY_DDL =
  "CREATE TRIGGER IF NOT EXISTS mcp_audit_events_no_update BEFORE UPDATE ON mcp_audit_events " +
  "BEGIN SELECT RAISE(ABORT, 'mcp audit events are append-only'); END";
export const MCP_AUDIT_NO_DELETE_DDL =
  "CREATE TRIGGER IF NOT EXISTS mcp_audit_events_no_delete BEFORE DELETE ON mcp_audit_events " +
  "BEGIN SELECT RAISE(ABORT, 'mcp audit events are append-only'); END";

export const PUBLICATION_RUNS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS publication_runs (" +
  "id TEXT PRIMARY KEY, site_id TEXT NOT NULL, provider TEXT NOT NULL, " +
  "snapshot_hash TEXT NOT NULL, revision_ids_json TEXT NOT NULL, status TEXT NOT NULL, " +
  "attempts INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, finished_at TEXT, " +
  "error_code TEXT, commit_sha TEXT, pages_url TEXT)";
export const PUBLICATION_RUNS_SNAPSHOT_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_publication_runs_snapshot ON publication_runs(snapshot_hash, started_at DESC)";
export const PUBLICATION_RUNS_STATUS_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_publication_runs_status ON publication_runs(status, started_at DESC)";

export const RESOLUTION_BUDGET_CONFIG_DDL =
  "CREATE TABLE IF NOT EXISTS resolution_budget_config (" +
  "id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL, " +
  "revision INTEGER NOT NULL CHECK (revision > 0), updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)";
