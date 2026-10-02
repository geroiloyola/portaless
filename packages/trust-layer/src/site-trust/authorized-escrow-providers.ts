// Allowlist de proveedores de escrow autorizados a reportar sobre la
// fuente "escrow_report" de SiteTrustScore -- v0.0.9.23. Analoga a
// authorized-agents.ts, pero sin estandar publico equivalente a Web Bot
// Auth: la autenticacion es una API key hasheada por proveedor.
//
// hashApiKey() usa Web Crypto (SHA-256), la misma primitiva que
// functions/trust/[siteId]/vote.js para hashear IPs.
//
// No hay autoservicio: Portaless genera y entrega la API key fuera de
// banda. Es deliberadamente la barrera de entrada mas alta de las 4
// fuentes, coherente con que escrow_report es ground truth. Ver
// docs/architecture/site-trust-score.md.
//
// grant() GENERA la key y la devuelve en texto plano SOLO en su resultado;
// solo se persiste el hash SHA-256 (write-once, never readable). revoke()
// hace soft-delete (active = 0).
//
// v0.0.9.27: SqliteAuthorizedEscrowProvidersStore migrado de node:sqlite a
// better-sqlite3 via openSqlite(). Uso: await SqliteAuthorizedEscrowProvidersStore.open(path).
// La factory ya NO cae a memoria si PORTALESS_SQLITE_PATH esta definido y
// SQLite no abre (antes: todos los reportes de escrow rechazados en silencio).
//
// APW v1.2 (5.3, ERRATA E-4): cada proveedor puede registrar su clave publica
// Ed25519 (public_key_jwk). La API key sigue autenticando el endpoint; la
// clave publica verifica la atestacion JWS, que es la prueba exportable. Sin
// clave publica el proveedor no puede reportar. Re-autorizar sin clave
// conserva la que ya tenia (COALESCE). La API key se genera igual que en
// scripts/onboard-escrow-provider.mjs: prefijo pless_escrow_ + 32 bytes
// aleatorios en base64url.
//
// setPublicKey() carga, reemplaza o quita (null) la clave publica SIN rotar
// la API key ni cambiar el estado del proveedor. grant() rota la API key; para
// solo actualizar la clave, usar setPublicKey().

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface AuthorizedEscrowProvider {
  providerId: string;
  displayName: string;
  active: boolean;
  authorizedAt: string;
  authorizedBy: string;
  /** Clave publica Ed25519 del proveedor ({ kty, crv, x }) o null si no registro ninguna. */
  publicKeyJwk: JsonWebKey | null;
}

export interface GrantAuthorizedEscrowProviderInput {
  providerId: string;
  displayName: string;
  authorizedBy: string;
  /** Clave publica Ed25519 del proveedor. Se valida con normalizeProviderPublicKey(). */
  publicKeyJwk?: JsonWebKey | null;
}

export interface GrantAuthorizedEscrowProviderResult {
  provider: AuthorizedEscrowProvider;
  /** API key en texto plano -- SOLO disponible en este resultado, nunca
   * se persiste ni se puede recuperar despues. Debe entregarse al
   * proveedor fuera de banda inmediatamente. */
  apiKey: string;
}

export interface AuthorizedEscrowProvidersStore {
  isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean>;
  list(): Promise<AuthorizedEscrowProvider[]>;
  grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult>;
  revoke(providerId: string): Promise<void>;
  /** Clave publica de un proveedor ACTIVO, o null. */
  getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null>;
  /**
   * Carga, reemplaza o quita (null) la clave publica sin rotar la API key.
   * Lanza INVALID_PUBLIC_KEY_JWK si la clave no es valida. Devuelve false si
   * el proveedor no existe.
   */
  setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean>;
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

export const INVALID_PUBLIC_KEY_JWK = "invalid_public_key_jwk";

const ADD_PUBLIC_KEY_COLUMN_SQL = "ALTER TABLE authorized_escrow_providers ADD COLUMN public_key_jwk TEXT";
const SET_PUBLIC_KEY_SQL = "UPDATE authorized_escrow_providers SET public_key_jwk = ? WHERE provider_id = ?";

function isDuplicateColumnError(err: unknown): boolean {
  return /duplicate column/i.test(String((err as Error)?.message));
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/, "");
}

/** Mismo formato que scripts/onboard-escrow-provider.mjs. */
export function generateApiKey(): string {
  return `pless_escrow_${bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * Valida una clave publica Ed25519 y la reduce a { kty, crv, x }. Acepta un
 * objeto o un string JSON. Lanza INVALID_PUBLIC_KEY_JWK; nunca acepta una
 * clave con `d` (privada).
 */
export function normalizeProviderPublicKey(input: unknown): JsonWebKey {
  let jwk: any = input;
  if (typeof input === "string") {
    try {
      jwk = JSON.parse(input);
    } catch {
      throw new Error(INVALID_PUBLIC_KEY_JWK);
    }
  }
  if (
    !jwk ||
    typeof jwk !== "object" ||
    jwk.kty !== "OKP" ||
    jwk.crv !== "Ed25519" ||
    typeof jwk.x !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
    jwk.d !== undefined
  ) {
    throw new Error(INVALID_PUBLIC_KEY_JWK);
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

/** null o undefined quitan la clave; cualquier otro valor tiene que ser una clave valida. */
function serializePublicKeyOrNull(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  return JSON.stringify(normalizeProviderPublicKey(input));
}

function parsePublicKey(raw: unknown): JsonWebKey | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeProviderPublicKey(raw);
  } catch {
    return null;
  }
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
        try {
          await this.db.prepare(ADD_PUBLIC_KEY_COLUMN_SQL).bind().run();
        } catch (err) {
          if (!isDuplicateColumnError(err)) throw err;
        }
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
        authorized_by TEXT NOT NULL
      );
    `);
    try {
      this.db.exec(ADD_PUBLIC_KEY_COLUMN_SQL);
    } catch (err) {
      if (!isDuplicateColumnError(err)) throw err;
    }
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
export class InMemoryAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private providers = new Map<string, MemoryProvider>();

  constructor(authorizedPairs: Set<string> = new Set()) {
    const now = new Date().toISOString();
    for (const pair of authorizedPairs) {
      const [providerId, apiKeyHash] = pair.split(":");
      this.providers.set(providerId, {
        providerId,
        displayName: providerId,
        active: true,
        authorizedAt: now,
        authorizedBy: "test-seed",
        publicKeyJwk: null,
        apiKeyHash,
      });
    }
  }

  async isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    return provider?.active === true && provider.apiKeyHash === apiKeyHash;
  }

  async list(): Promise<AuthorizedEscrowProvider[]> {
    return [...this.providers.values()].map(({ apiKeyHash, ...provider }) => provider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    const { apiKey, apiKeyHash, authorizedAt, publicKeyJwk } = await prepareGrant(input);
    const previous = this.providers.get(input.providerId);
    const stored: MemoryProvider = {
      providerId: input.providerId,
      displayName: input.displayName,
      active: true,
      authorizedAt,
      authorizedBy: input.authorizedBy,
      publicKeyJwk: publicKeyJwk ?? previous?.publicKeyJwk ?? null,
      apiKeyHash,
    };
    this.providers.set(input.providerId, stored);
    const { apiKeyHash: _hash, ...provider } = stored;
    return { provider, apiKey };
  }

  async revoke(providerId: string): Promise<void> {
    const existing = this.providers.get(providerId);
    if (existing) existing.active = false;
  }

  async getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null> {
    const provider = this.providers.get(providerId);
    return provider?.active ? provider.publicKeyJwk : null;
  }

  async setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean> {
    const serialized = serializePublicKeyOrNull(publicKeyJwk);
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    provider.publicKeyJwk = serialized ? JSON.parse(serialized) : null;
    return true;
  }
}

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
