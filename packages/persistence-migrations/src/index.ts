// Contrato de datos de Portaless: migraciones NUMERADAS hacia adelante.
//
// El problema que resuelve: hasta ahora `schema.sql` se re-aplicaba entero en
// cada arranque y cada store se auto-migraba con `ALTER TABLE ... ADD COLUMN`
// dispersos (swallow del dup-column). Funcionaba, pero no dejaba registro, ni
// orden, ni backup, ni proteccion contra una base MAS NUEVA que el codigo.
//
// Modelo:
//   - `schema_migrations` (version, name, applied_at) registra que migraciones
//     se aplicaron. La crea el runner.
//   - `SCHEMA_VERSION` es la version que este codigo espera. La forma COMPLETA
//     del schema vive en `schema.sql` (idempotente); las entradas de MIGRATIONS
//     son los deltas numerados.
//   - v1 = baseline: no lleva SQL (la crea `schema.sql`), solo deja registrada
//     la version para que futuras migraciones (v2, v3, ...) tengan una base.
//   - Fail-closed: si la base esta en una version MAYOR que el codigo, el
//     arranque se niega (no se degrada el schema en silencio).
//
// Modulo PURO (sin I/O, sin SQLite): lo importan el runner, el doctor y los
// tests, y tambien `functions/` y `server/`.

import { MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_NO_DELETE_DDL, MCP_AUDIT_TABLE_DDL, PLUGIN_EMAIL_QUOTA_DDL, PUBLICATION_RUNS_SNAPSHOT_INDEX_DDL, PUBLICATION_RUNS_STATUS_INDEX_DDL, PUBLICATION_RUNS_TABLE_DDL, RESOLUTION_BUDGET_CONFIG_DDL } from "./ddl";

export interface Migration {
  version: number;
  name: string;
  /** Statements idempotentes. Vacio en el baseline (lo cubre schema.sql). */
  statements: string[];
  /**
   * Columnas a agregar de forma IDEMPOTENTE (el runner chequea la columna con
   * `pragma_table_info` antes de ALTER ... ADD COLUMN). Es como se consolidan
   * los `ALTER TABLE` que antes vivian dispersos en cada store.
   */
  addColumns?: Array<{ table: string; column: string; type: string }>;
  /** Tables created by this delta, with their required columns (for preflight). */
  createsTables?: Record<string, string[]>;
}

/** Columnas historicas (consolidadas desde los stores, ver v2/v3). */
const IDENTITY_AND_ATTESTATION_COLUMNS = [
  { table: "site_identity_keys", column: "key_id", type: "TEXT" },
  { table: "site_identity_keys", column: "key_sequence", type: "INTEGER" },
  { table: "site_attestation_log", column: "att_jws", type: "TEXT" },
  { table: "site_trust_agent_verifications", column: "attestation_jti", type: "TEXT" },
  { table: "site_trust_agent_verifications", column: "attestation_jws", type: "TEXT" },
  { table: "site_trust_escrow_reports", column: "attestation_jti", type: "TEXT" },
  { table: "site_trust_escrow_reports", column: "attestation_jws", type: "TEXT" },
  { table: "site_trust_self_evaluations", column: "attestation_jti", type: "TEXT" },
  { table: "site_trust_self_evaluations", column: "attestation_jws", type: "TEXT" },
  { table: "site_trust_read_policies", column: "public_overrides", type: "TEXT" },
  { table: "usage_ledger", column: "reader_did", type: "TEXT" },
  { table: "authorized_escrow_providers", column: "public_key_jwk", type: "TEXT" },
];

const USER_AND_PLUGIN_COLUMNS = [
  { table: "users", column: "email", type: "TEXT" },
  { table: "users", column: "provider", type: "TEXT" },
  { table: "users", column: "totp_secret", type: "TEXT" },
  { table: "users", column: "totp_enabled_at", type: "TEXT" },
  { table: "users", column: "oauth_provider", type: "TEXT" },
  { table: "users", column: "oauth_subject", type: "TEXT" },
  { table: "plugin_artifacts", column: "manifest_json", type: "TEXT" },
];

const PAGE_REVISION_COLUMNS = [
  { table: "pages", column: "publication_id", type: "TEXT" },
  { table: "pages", column: "revision_id", type: "TEXT" },
  { table: "pages", column: "revision_no", type: "INTEGER" },
  { table: "pages", column: "content_hash", type: "TEXT" },
];

const PAGE_REVISION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS page_revisions (
    revision_id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    revision_no INTEGER NOT NULL,
    parent_revision_id TEXT,
    content_hash TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT,
    approved_at TEXT,
    approved_by TEXT,
    UNIQUE (publication_id, revision_no)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_page_revisions_public_history ON page_revisions (publication_id, approved_at, revision_no)",
  "CREATE TRIGGER IF NOT EXISTS page_revisions_no_update BEFORE UPDATE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END",
  "CREATE TRIGGER IF NOT EXISTS page_revisions_no_delete BEFORE DELETE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END",
];

const PAGE_REVISION_EVIDENCE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS page_revision_evidence (
    evidence_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL,
    rules_version TEXT NOT NULL,
    sample_size INTEGER,
    weight REAL,
    calculation_json TEXT NOT NULL,
    proof_json TEXT,
    recorded_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_page_revision_evidence_revision ON page_revision_evidence (revision_id, observed_at, evidence_id)",
  "CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_update BEFORE UPDATE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END",
  "CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_delete BEFORE DELETE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END",
];

const PAGE_REVISION_APPROVAL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS page_revision_approvals (
    revision_id TEXT PRIMARY KEY,
    approved_at TEXT NOT NULL,
    approved_by TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_page_revision_approvals_approved_at ON page_revision_approvals (approved_at, revision_id)",
  "CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_update BEFORE UPDATE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END",
  "CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_delete BEFORE DELETE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END",
  "INSERT OR IGNORE INTO page_revision_approvals (revision_id, approved_at, approved_by) SELECT revision_id, approved_at, approved_by FROM page_revisions WHERE approved_at IS NOT NULL",
];

const MCP_AUDIT_EVENT_STATEMENTS = [MCP_AUDIT_TABLE_DDL, MCP_AUDIT_INDEX_DDL, MCP_AUDIT_APPEND_ONLY_DDL, MCP_AUDIT_NO_DELETE_DDL];

/**
 * v4 -- capacidad `email:send` (TASK 5). Tablas nuevas del sprint de email:
 *   - `plugin_email_quota` (cuota diaria por plugin: el rate limit en la base).
 *   - `site_settings` (config del sitio, incluida la de email) ya existia desde
 *     la Fase 6, asi que es baseline (v1); NO se re-crea aca.
 * Idempotentes (CREATE TABLE IF NOT EXISTS): una base nueva ya las tiene por
 * `schema.sql` y esto es no-op; una base vieja las crea al migrar.
 *
 * La DDL se importa de `./ddl.ts` (fuente unica compartida con el store). Una
 * vez que esta migracion se libere, su SQL queda CONGELADO (es historia del
 * libro mayor): cualquier cambio futuro va en una migracion nueva (v5+), no
 * editando esta.
 */
const EMAIL_CAPABILITY_STATEMENTS = [PLUGIN_EMAIL_QUOTA_DDL];
const PUBLICATION_RUNS_STATEMENTS = [PUBLICATION_RUNS_TABLE_DDL, PUBLICATION_RUNS_SNAPSHOT_INDEX_DDL, PUBLICATION_RUNS_STATUS_INDEX_DDL];
const RESOLUTION_BUDGET_CONFIG_STATEMENTS = [RESOLUTION_BUDGET_CONFIG_DDL];

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", statements: [] },
  {
    version: 2,
    name: "identity_and_attestation_columns",
    statements: [],
    addColumns: IDENTITY_AND_ATTESTATION_COLUMNS,
  },
  {
    version: 3,
    name: "user_and_plugin_columns",
    statements: [],
    addColumns: USER_AND_PLUGIN_COLUMNS,
  },
  {
    version: 4,
    name: "email_capabilities",
    statements: EMAIL_CAPABILITY_STATEMENTS,
    createsTables: { plugin_email_quota: ["plugin_id", "day", "count"] },
  },
  {
    version: 5,
    name: "page_revision_history",
    statements: PAGE_REVISION_STATEMENTS,
    addColumns: PAGE_REVISION_COLUMNS,
    createsTables: { page_revisions: ["revision_id", "publication_id", "slug", "revision_no", "parent_revision_id", "content_hash", "layout_json", "created_at", "created_by", "approved_at", "approved_by"] },
  },
  {
    version: 6,
    name: "page_revision_evidence",
    statements: PAGE_REVISION_EVIDENCE_STATEMENTS,
    createsTables: { page_revision_evidence: ["evidence_id", "revision_id", "observed_at", "source", "rules_version", "sample_size", "weight", "calculation_json", "proof_json", "recorded_at"] },
  },
  {
    version: 7,
    name: "page_revision_approvals",
    statements: PAGE_REVISION_APPROVAL_STATEMENTS,
    createsTables: { page_revision_approvals: ["revision_id", "approved_at", "approved_by"] },
  },
  {
    version: 8,
    name: "mcp_audit_events",
    statements: MCP_AUDIT_EVENT_STATEMENTS,
    createsTables: { mcp_audit_events: ["event_id", "timestamp", "agent_key_id", "tool_name", "capability_id", "outcome", "error_code", "subject_id", "revision_id"] },
  },
  {
    version: 9,
    name: "publication_runs",
    statements: PUBLICATION_RUNS_STATEMENTS,
    createsTables: { publication_runs: ["id", "site_id", "provider", "snapshot_hash", "revision_ids_json", "status", "attempts", "started_at", "finished_at", "error_code", "commit_sha", "pages_url"] },
  },
  {
    version: 10,
    name: "resolution_budget_config",
    statements: RESOLUTION_BUDGET_CONFIG_STATEMENTS,
    createsTables: { resolution_budget_config: ["id", "config_json", "revision", "updated_at", "updated_by"] },
  },
  {
    version: 11,
    name: "session_mfa_verified",
    statements: [],
    addColumns: [{ table: "sessions", column: "mfa_verified", type: "INTEGER NOT NULL DEFAULT 0" }],
  },
];

/**
 * Column contract used before adopting an unversioned database and whenever a
 * database claims the current schema version. Keep this independent of
 * schema.sql so edge middleware and doctor can check it without filesystem IO.
 * The v2/v3 columns are appended from the migration declarations below.
 */
export const REQUIRED_SCHEMA_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["username", "password_hash", "role", "created_at", "email", "provider", "totp_secret", "totp_enabled_at", "oauth_provider", "oauth_subject"],
  sessions: ["token", "username", "role", "created_at", "expires_at", "mfa_verified"],
  auth_mfa_challenges: ["token", "username", "role", "expires_at", "failed_attempts"],
  auth_rate_limits: ["bucket", "window_start", "count"],
  permission_grants: ["subject_type", "subject_id", "capability_id", "granted", "granted_at", "granted_by"],
  pages: ["slug", "layout_json", "updated_at", "updated_by", "publication_id", "revision_id", "revision_no", "content_hash"],
  page_revisions: ["revision_id", "publication_id", "slug", "revision_no", "parent_revision_id", "content_hash", "layout_json", "created_at", "created_by", "approved_at", "approved_by"],
  page_revision_evidence: ["evidence_id", "revision_id", "observed_at", "source", "rules_version", "sample_size", "weight", "calculation_json", "proof_json", "recorded_at"],
  page_revision_approvals: ["revision_id", "approved_at", "approved_by"],
  site_identity: ["site_id", "did", "domain", "public_key_jwk", "private_key_jwk_encrypted", "private_key_encryption_iv", "key_algorithm", "created_at", "created_by"],
  capability_bridge_tokens: ["token", "plugin_name", "granted_capabilities_json", "issued_at", "expires_at"],
  webbotauth_nonces: ["nonce", "expires_at"],
  mcp_agent_tokens: ["token_hash", "agent_key_id", "display_name", "created_at", "revoked"],
  mcp_audit_events: ["event_id", "timestamp", "agent_key_id", "tool_name", "capability_id", "outcome", "error_code", "subject_id", "revision_id"],
  publication_runs: ["id", "site_id", "provider", "snapshot_hash", "revision_ids_json", "status", "attempts", "started_at", "finished_at", "error_code", "commit_sha", "pages_url"],
  resolution_budget_config: ["id", "config_json", "revision", "updated_at", "updated_by"],
  site_atproto_links: ["site_id", "handle", "added_at"],
  cloud_images: ["image_id", "content_hash", "content_type", "byte_length", "declared_origin", "site_id", "site_did", "key_id", "key_algorithm", "signed_at", "sidecar_json", "bytes", "created_by", "created_at"],
  site_skin: ["site_id", "skin", "tokens_json", "updated_at"],
  settlement_provider_activations: ["provider_id", "credential_enc", "metadata_json", "verified_at", "activated_by"],
  deployment_oauth_states: ["state", "provider", "code_verifier", "user_id", "expires_at"],
  deployment_credentials: ["provider", "account_login", "access_token_enc", "refresh_token_enc", "access_expires_at", "refresh_expires_at", "connected_by", "updated_at"],
  element_packs: ["name", "pack_json", "updated_at"],
  theme_packs: ["name", "pack_json", "updated_at"],
  community_attestations: ["iss", "jti", "site_id", "sub", "category", "val", "iat", "jws", "emitter_first_seen_iat", "received_at"],
  activity_events: ["id", "kind", "actor", "subject", "detail", "occurred_at"],
  plugin_artifacts: ["publisher", "name", "version", "code_hash", "total_bytes", "chunk_count", "created_at", "manifest_json"],
  plugin_artifact_chunks: ["publisher", "name", "version", "seq", "data"],
  plugin_storage: ["plugin_id", "key", "value_json", "size_bytes", "updated_at"],
  plugin_email_quota: ["plugin_id", "day", "count"],
  site_identity_keys: ["kid", "site_id", "public_key_jwk", "private_key_encrypted", "private_key_encryption_iv", "key_algorithm", "valid_from", "valid_to", "key_id", "key_sequence"],
  site_attestation_log: ["site_id", "seq", "entry_jws", "entry_hash", "prev_hash", "att_hash", "kid", "ts", "att_jws"],
  site_trust_agent_verifications: ["site_id", "category", "verified", "detail_json", "agent_key_id", "verified_at", "attestation_jws", "attestation_jti"],
  site_trust_escrow_reports: ["site_id", "transaction_outcome", "escrow_provider", "amount_currency", "reported_at", "attestation_jws", "attestation_jti"],
  site_trust_self_evaluations: ["site_id", "category", "declared_value", "evidence_url", "declared_by", "declared_at", "attestation_jws", "attestation_jti"],
  usage_ledger: ["period", "operator_key_id", "operator_name_claimed", "requests_total", "requests_charged", "requests_free_tier", "revenue_usd", "policy_violations_detected", "first_seen", "last_seen", "reader_did"],
  authorized_escrow_providers: ["provider_id", "api_key_hash", "display_name", "active", "authorized_at", "authorized_by", "public_key_jwk"],
};

export const BASELINE_REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["username", "password_hash", "role", "created_at"],
  pages: ["slug", "layout_json", "updated_at"],
};

export function missingSchemaColumns(
  actual: Readonly<Record<string, readonly string[]>>,
  contract: Readonly<Record<string, readonly string[]>> = REQUIRED_SCHEMA_COLUMNS,
): string[] {
  const missing: string[] = [];
  for (const [table, required] of Object.entries(contract)) {
    const actualColumns = new Set(actual[table] ?? []);
    if (!(table in actual)) missing.push(`${table} (tabla)`);
    for (const column of required) {
      if (!actualColumns.has(column)) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

export class SchemaContractError extends Error {
  constructor(public readonly missing: string[]) {
    super(`El esquema real no cumple el contrato de Portaless: ${missing.join(", ")}`);
    this.name = "SchemaContractError";
  }
}

/** Version del schema que ESTE codigo espera (el maximo de MIGRATIONS). */
export function schemaVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}

/** Migraciones pendientes para una base que esta en `current`. */
export function pendingFrom(current: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
}

export class SchemaNewerThanCodeError extends Error {
  constructor(
    public readonly dbVersion: number,
    public readonly codeVersion: number,
  ) {
    super(
      `La base esta en la version ${dbVersion} y este codigo espera la ${codeVersion}. ` +
        "Actualiza el codigo (git pull / nueva imagen) antes de arrancar: no se degrada el schema.",
    );
    this.name = "SchemaNewerThanCodeError";
  }
}

/** Fail-closed: una base mas nueva que el codigo NO arranca. */
export function assertCompatible(dbVersion: number, codeVersion = schemaVersion()): void {
  if (dbVersion > codeVersion) throw new SchemaNewerThanCodeError(dbVersion, codeVersion);
}
