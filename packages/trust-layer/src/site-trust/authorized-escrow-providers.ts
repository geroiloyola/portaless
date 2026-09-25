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
// grant() GENERA la key (crypto.randomUUID()) y la devuelve en texto plano
// SOLO en su resultado; solo se persiste el hash SHA-256 (write-once, never
// readable). revoke() hace soft-delete (active = 0).
//
// v0.0.9.27: SqliteAuthorizedEscrowProvidersStore migrado de node:sqlite a
// better-sqlite3 via openSqlite(). Uso: await SqliteAuthorizedEscrowProvidersStore.open(path).
// La factory ya NO cae a memoria si PORTALESS_SQLITE_PATH esta definido y
// SQLite no abre (antes: todos los reportes de escrow rechazados en silencio).

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface AuthorizedEscrowProvider {
  providerId: string;
  displayName: string;
  active: boolean;
  authorizedAt: string;
  authorizedBy: string;
}

export interface GrantAuthorizedEscrowProviderInput {
  providerId: string;
  displayName: string;
  authorizedBy: string;
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

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function rowToProvider(row: any): AuthorizedEscrowProvider {
  return {
    providerId: row.provider_id,
    displayName: row.display_name,
    active: Boolean(row.active),
    authorizedAt: row.authorized_at,
    authorizedBy: row.authorized_by,
  };
}

const GRANT_SQL = `INSERT INTO authorized_escrow_providers
           (provider_id, api_key_hash, display_name, active, authorized_at, authorized_by)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           api_key_hash = excluded.api_key_hash,
           display_name = excluded.display_name,
           active = 1,
           authorized_at = excluded.authorized_at,
           authorized_by = excluded.authorized_by`;

export class D1AuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  constructor(private db: D1DatabaseLike) {}

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
    const { results } = await this.db
      .prepare("SELECT * FROM authorized_escrow_providers ORDER BY authorized_at DESC")
      .bind()
      .all();
    return results.map(rowToProvider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const authorizedAt = new Date().toISOString();

    await this.db
      .prepare(GRANT_SQL)
      .bind(input.providerId, apiKeyHash, input.displayName, authorizedAt, input.authorizedBy)
      .run();

    return {
      provider: {
        providerId: input.providerId,
        displayName: input.displayName,
        active: true,
        authorizedAt,
        authorizedBy: input.authorizedBy,
      },
      apiKey,
    };
  }

  async revoke(providerId: string): Promise<void> {
    await this.db
      .prepare("UPDATE authorized_escrow_providers SET active = 0 WHERE provider_id = ?")
      .bind(providerId)
      .run();
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
      .prepare("SELECT * FROM authorized_escrow_providers ORDER BY authorized_at DESC")
      .all();
    return rows.map(rowToProvider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const authorizedAt = new Date().toISOString();

    this.db
      .prepare(GRANT_SQL)
      .run(input.providerId, apiKeyHash, input.displayName, authorizedAt, input.authorizedBy);

    return {
      provider: {
        providerId: input.providerId,
        displayName: input.displayName,
        active: true,
        authorizedAt,
        authorizedBy: input.authorizedBy,
      },
      apiKey,
    };
  }

  async revoke(providerId: string): Promise<void> {
    this.db
      .prepare("UPDATE authorized_escrow_providers SET active = 0 WHERE provider_id = ?")
      .run(providerId);
  }

  close(): void {
    this.db.close();
  }
}

/** Implementacion en memoria -- util para tests. Nunca autoriza nada por
 * defecto; hay que agregar explicitamente los pares providerId+apiKeyHash
 * de prueba. */
export class InMemoryAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private providers = new Map<string, AuthorizedEscrowProvider & { apiKeyHash: string }>();

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
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const authorizedAt = new Date().toISOString();

    this.providers.set(input.providerId, {
      providerId: input.providerId,
      displayName: input.displayName,
      active: true,
      authorizedAt,
      authorizedBy: input.authorizedBy,
      apiKeyHash,
    });

    return {
      provider: {
        providerId: input.providerId,
        displayName: input.displayName,
        active: true,
        authorizedAt,
        authorizedBy: input.authorizedBy,
      },
      apiKey,
    };
  }

  async revoke(providerId: string): Promise<void> {
    const existing = this.providers.get(providerId);
    if (existing) existing.active = false;
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
