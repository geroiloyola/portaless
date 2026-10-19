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

/**
 * v4 -- capacidad `email:send` (TASK 5). Tablas nuevas del sprint de email:
 *   - `plugin_email_quota` (cuota diaria por plugin: el rate limit en la base).
 *   - `site_settings` (config del sitio, incluida la de email) ya existia desde
 *     la Fase 6, asi que es baseline (v1); NO se re-crea aca.
 * Idempotentes (CREATE TABLE IF NOT EXISTS): una base nueva ya las tiene por
 * `schema.sql` y esto es no-op; una base vieja las crea al migrar.
 */
const EMAIL_CAPABILITY_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS plugin_email_quota (" +
    "plugin_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, " +
    "PRIMARY KEY (plugin_id, day))",
];

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
  },
];

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
