import { openSqlite } from "@portaless/sqlite-driver";
import {
  INVALID_PUBLIC_KEY_JWK,
  InMemoryAuthorizedEscrowProvidersStore,
  generateApiKey,
  hashApiKey,
  normalizeProviderPublicKey,
  type AuthorizedEscrowProvider,
  type AuthorizedEscrowProvidersStore,
  type D1DatabaseLike,
  type GrantAuthorizedEscrowProviderInput,
  type GrantAuthorizedEscrowProviderResult,
} from "@verared/trust-layer/site-trust";
const SET_PUBLIC_KEY_SQL = "UPDATE authorized_escrow_providers SET public_key_jwk = ? WHERE provider_id = ?";
function isDuplicateColumnError(err: unknown): boolean {
  return /duplicate column/i.test(String((err as Error)?.message));
}
function serializePublicKeyOrNull(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  return JSON.stringify(normalizeProviderPublicKey(input));
}
function parsePublicKey(raw: unknown): JsonWebKey | null {
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw) as JsonWebKey; } catch { return null; }
}

function rowToProvider(row: any): AuthorizedEscrowProvider {
  return {
    providerId: row.provider_id,
    displayName: row.display_name,
    active: Boolean(row.active),
    authorizedAt: row.authorized_at,
    authorizedBy: row.authorized_by,
    publicKeyJwk: parsePublicKey(row.public_key_jwk),
  };
}

const GRANT_SQL = `INSERT INTO authorized_escrow_providers
           (provider_id, api_key_hash, display_name, active, authorized_at, authorized_by, public_key_jwk)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           api_key_hash = excluded.api_key_hash,
           display_name = excluded.display_name,
           active = 1,
           authorized_at = excluded.authorized_at,
           authorized_by = excluded.authorized_by,
           public_key_jwk = COALESCE(excluded.public_key_jwk, authorized_escrow_providers.public_key_jwk)`;

const PROVIDER_COLUMNS = "provider_id, display_name, active, authorized_at, authorized_by, public_key_jwk";

async function prepareGrant(input: GrantAuthorizedEscrowProviderInput) {
  const publicKeyJwk =
    input.publicKeyJwk === undefined || input.publicKeyJwk === null ? null : normalizeProviderPublicKey(input.publicKeyJwk);
  const apiKey = generateApiKey();
  return {
    apiKey,
    apiKeyHash: await hashApiKey(apiKey),
    authorizedAt: new Date().toISOString(),
    publicKeyJwk,
  };
}

export class D1AuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private db: D1DatabaseLike) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
      })();
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  async isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT 1 as hit FROM authorized_escrow_providers WHERE provider_id = ? AND api_key_hash = ? AND active = 1"
      )
      .bind(providerId, apiKeyHash)
      .first<{ hit: number }>();
    return row !== null;
  }

  async list(): Promise<AuthorizedEscrowProvider[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM authorized_escrow_providers ORDER BY authorized_at DESC`)
      .bind()
      .all();
    return results.map(rowToProvider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    await this.ensureSchema();
    const { apiKey, apiKeyHash, authorizedAt, publicKeyJwk } = await prepareGrant(input);
    await this.db
      .prepare(GRANT_SQL)
      .bind(
        input.providerId,
        apiKeyHash,
        input.displayName,
        authorizedAt,
        input.authorizedBy,
        publicKeyJwk ? JSON.stringify(publicKeyJwk) : null
      )
      .run();
    const row = await this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM authorized_escrow_providers WHERE provider_id = ?`)
      .bind(input.providerId)
      .first();
    return { provider: rowToProvider(row), apiKey };
  }

  async revoke(providerId: string): Promise<void> {
    await this.db
      .prepare("UPDATE authorized_escrow_providers SET active = 0 WHERE provider_id = ?")
      .bind(providerId)
      .run();
  }

  async getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null> {
    await this.ensureSchema();
    const row = await this.db
      .prepare("SELECT public_key_jwk FROM authorized_escrow_providers WHERE provider_id = ? AND active = 1")
      .bind(providerId)
      .first<{ public_key_jwk: string | null }>();
    return parsePublicKey(row?.public_key_jwk);
  }

  async setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean> {
    const serialized = serializePublicKeyOrNull(publicKeyJwk);
    await this.ensureSchema();
    const exists = await this.db
      .prepare("SELECT 1 as hit FROM authorized_escrow_providers WHERE provider_id = ?")
      .bind(providerId)
      .first<{ hit: number }>();
    if (!exists) return false;
    await this.db.prepare(SET_PUBLIC_KEY_SQL).bind(serialized, providerId).run();
    return true;
  }
}

export class SqliteAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteAuthorizedEscrowProvidersStore> {
    return new SqliteAuthorizedEscrowProvidersStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteAuthorizedEscrowProvidersStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqliteAuthorizedEscrowProvidersStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
        provider_id TEXT PRIMARY KEY,
        api_key_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        authorized_at TEXT NOT NULL,
        authorized_by TEXT NOT NULL,
        public_key_jwk TEXT
      );
    `);
  }

  async isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean> {
    const row = this.db
      .prepare(
        "SELECT 1 as hit FROM authorized_escrow_providers WHERE provider_id = ? AND api_key_hash = ? AND active = 1"
      )
      .get(providerId, apiKeyHash);
    return row !== undefined;
  }

  async list(): Promise<AuthorizedEscrowProvider[]> {
    const rows = this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM authorized_escrow_providers ORDER BY authorized_at DESC`)
      .all();
    return rows.map(rowToProvider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    const { apiKey, apiKeyHash, authorizedAt, publicKeyJwk } = await prepareGrant(input);
    this.db
      .prepare(GRANT_SQL)
      .run(
        input.providerId,
        apiKeyHash,
        input.displayName,
        authorizedAt,
        input.authorizedBy,
        publicKeyJwk ? JSON.stringify(publicKeyJwk) : null
      );
    const row = this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM authorized_escrow_providers WHERE provider_id = ?`)
      .get(input.providerId);
    return { provider: rowToProvider(row), apiKey };
  }

  async revoke(providerId: string): Promise<void> {
    this.db
      .prepare("UPDATE authorized_escrow_providers SET active = 0 WHERE provider_id = ?")
      .run(providerId);
  }

  async getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null> {
    const row = this.db
      .prepare("SELECT public_key_jwk FROM authorized_escrow_providers WHERE provider_id = ? AND active = 1")
      .get(providerId) as { public_key_jwk: string | null } | undefined;
    return parsePublicKey(row?.public_key_jwk);
  }

  async setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean> {
    const serialized = serializePublicKeyOrNull(publicKeyJwk);
    const result = this.db.prepare(SET_PUBLIC_KEY_SQL).run(serialized, providerId);
    return (result?.changes ?? 0) > 0;
  }

  close(): void {
    this.db.close();
  }
}

type MemoryProvider = AuthorizedEscrowProvider & { apiKeyHash: string };

/** Implementacion en memoria -- util para tests. Nunca autoriza nada por
 * defecto; hay que agregar explicitamente los pares providerId+apiKeyHash
 * de prueba, o usar grant(). */
export interface AuthorizedEscrowProvidersFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createAuthorizedEscrowProvidersStore(
  env: AuthorizedEscrowProvidersFactoryEnv
): Promise<AuthorizedEscrowProvidersStore> {
  if (env.DB) {
    return new D1AuthorizedEscrowProvidersStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteAuthorizedEscrowProvidersStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn(
    "[Portaless AuthorizedEscrowProviders] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria (sin proveedores autorizados)."
  );
  return new InMemoryAuthorizedEscrowProvidersStore();
}

