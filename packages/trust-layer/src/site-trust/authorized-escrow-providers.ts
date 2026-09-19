// Allowlist de proveedores de escrow autorizados a reportar sobre la
// fuente "escrow_report" de SiteTrustScore -- v0.0.9.23. Analoga a
// authorized-agents.ts (que resuelve la misma pregunta para "agent"),
// pero con un mecanismo distinto: no hay estandar publico equivalente a
// Web Bot Auth para proveedores de escrow, asi que la autenticacion es
// una API key hasheada por proveedor, no una firma criptografica de
// requests individuales.
//
// hashApiKey() usa Web Crypto (SHA-256), la misma primitiva que ya usa
// functions/trust/[siteId]/vote.js para hashear IPs -- consistente con
// el resto del repo, sin agregar una dependencia de hashing nueva.
//
// A diferencia de authorized_agents (donde CUALQUIERA puede generar un
// par Ed25519 y publicar un JWKS -- Web Bot Auth verifica identidad, no
// otorga autorizacion), aqui no hay ningun mecanismo de autoservicio en
// absoluto: Portaless genera y entrega la API key manualmente, fuera de
// banda, la primera vez que un proveedor real se integra. Es
// deliberadamente la barrera de entrada mas alta de las 4 fuentes,
// coherente con que escrow_report es ground truth. Ver
// docs/architecture/site-trust-score.md.

export interface AuthorizedEscrowProvidersStore {
  isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean>;
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
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
}

export class SqliteAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private db: any;

  constructor(dbPath: string) {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      throw new Error("node:sqlite no esta disponible. Requiere Node 22.5+.");
    }
    this.db = new DatabaseSync(dbPath);
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
}

/** Implementacion en memoria -- util para tests. Nunca autoriza nada por
 * defecto; hay que agregar explicitamente los pares providerId+apiKeyHash
 * de prueba. */
export class InMemoryAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  constructor(private authorizedPairs: Set<string> = new Set()) {}

  async isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean> {
    return this.authorizedPairs.has(`${providerId}:${apiKeyHash}`);
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
    try {
      return new SqliteAuthorizedEscrowProvidersStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(
        `[Portaless AuthorizedEscrowProviders] SQLite no disponible (${(err as Error).message}). Usando memoria (sin proveedores autorizados).`
      );
    }
  } else {
    console.warn(
      "[Portaless AuthorizedEscrowProviders] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria (sin proveedores autorizados)."
    );
  }

  return new InMemoryAuthorizedEscrowProvidersStore();
}
