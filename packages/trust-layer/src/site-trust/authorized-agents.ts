// Allowlist de agentes autorizados a reportar sobre la fuente "agent" de
// SiteTrustScore -- v0.0.9.21 (v0.0.9.24 agrega key_algorithm). Resuelve
// "¿tienes permiso?", una pregunta distinta de la que responde
// web-bot-auth.ts ("¿quien eres?"). Web Bot Auth verifica que una firma
// sea genuina de agent.example.com -- pero cualquiera puede generar un
// par Ed25519 y publicar un JWKS en su propio dominio. Sin esta
// allowlist, esa identidad verificada (pero no autorizada) alcanzaria
// para reportar verified:true sobre cualquier sitio. Ver
// docs/architecture/site-trust-score.md.
//
// Fase 1 (esta version): lista estricta, gestionada manualmente -- 1-2
// agentes conocidos, agregados a mano (o via scripts/onboard-agent.mjs)
// en la tabla authorized_agents.
// Fase 2 (futura, NO implementada aqui): abrir a cualquier agente
// verificado con un peso reducido en el score en vez de bloquear por
// completo a los no listados.
//
// key_algorithm (v0.0.9.24): columna agregada por crypto-agilidad, NO
// por soporte real de un segundo algoritmo. Ed25519 es vulnerable a
// computadoras cuanticas; guardar el algoritmo por fila evita una
// migracion de datos el dia que se agregue ML-DSA (FIPS 204). Ver
// "Crypto-agilidad" en docs/architecture/site-trust-score.md.
//
// grant/revoke/list: permiten dar de alta, revocar y listar agentes desde
// un endpoint bajo functions/admin/ sin pasar por el CLI. revoke() hace
// soft-delete (active = 0) -- se preserva el historial.
//
// v0.0.9.27: SqliteAuthorizedAgentsStore migrado de node:sqlite a
// better-sqlite3 via openSqlite(). Uso: await SqliteAuthorizedAgentsStore.open(path).
// La factory ya NO cae a memoria si PORTALESS_SQLITE_PATH esta definido y
// SQLite no abre: antes eso dejaba la allowlist vacia en silencio y todos
// los agentes legitimos quedaban rechazados sin ningun error visible.

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface AuthorizedAgent {
  agentKeyId: string;
  signatureAgentUrl: string;
  displayName: string;
  active: boolean;
  authorizedAt: string;
  authorizedBy: string;
  keyAlgorithm: string;
}

export interface GrantAuthorizedAgentInput {
  agentKeyId: string;
  signatureAgentUrl: string;
  displayName: string;
  authorizedBy: string;
  keyAlgorithm?: string;
}

export interface AuthorizedAgentsStore {
  isAuthorized(agentKeyId: string): Promise<boolean>;
  list(): Promise<AuthorizedAgent[]>;
  grant(input: GrantAuthorizedAgentInput): Promise<void>;
  revoke(agentKeyId: string): Promise<void>;
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

function rowToAuthorizedAgent(row: any): AuthorizedAgent {
  return {
    agentKeyId: row.agent_key_id,
    signatureAgentUrl: row.signature_agent_url,
    displayName: row.display_name,
    active: Boolean(row.active),
    authorizedAt: row.authorized_at,
    authorizedBy: row.authorized_by,
    keyAlgorithm: row.key_algorithm ?? "ed25519",
  };
}

const GRANT_SQL = `INSERT INTO authorized_agents
           (agent_key_id, signature_agent_url, display_name, active, authorized_at, authorized_by, key_algorithm)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(agent_key_id) DO UPDATE SET
           signature_agent_url = excluded.signature_agent_url,
           display_name = excluded.display_name,
           active = 1,
           authorized_at = excluded.authorized_at,
           authorized_by = excluded.authorized_by,
           key_algorithm = excluded.key_algorithm`;

export class D1AuthorizedAgentsStore implements AuthorizedAgentsStore {
  constructor(private db: D1DatabaseLike) {}

  async isAuthorized(agentKeyId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 as hit FROM authorized_agents WHERE agent_key_id = ? AND active = 1")
      .bind(agentKeyId)
      .first<{ hit: number }>();
    return row !== null;
  }

  async list(): Promise<AuthorizedAgent[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM authorized_agents ORDER BY authorized_at DESC")
      .bind()
      .all();
    return results.map(rowToAuthorizedAgent);
  }

  async grant(input: GrantAuthorizedAgentInput): Promise<void> {
    const authorizedAt = new Date().toISOString();
    await this.db
      .prepare(GRANT_SQL)
      .bind(
        input.agentKeyId,
        input.signatureAgentUrl,
        input.displayName,
        authorizedAt,
        input.authorizedBy,
        input.keyAlgorithm ?? "ed25519"
      )
      .run();
  }

  async revoke(agentKeyId: string): Promise<void> {
    await this.db
      .prepare("UPDATE authorized_agents SET active = 0 WHERE agent_key_id = ?")
      .bind(agentKeyId)
      .run();
  }
}

export class SqliteAuthorizedAgentsStore implements AuthorizedAgentsStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteAuthorizedAgentsStore> {
    return new SqliteAuthorizedAgentsStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteAuthorizedAgentsStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqliteAuthorizedAgentsStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authorized_agents (
        agent_key_id TEXT PRIMARY KEY,
        signature_agent_url TEXT NOT NULL,
        display_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        authorized_at TEXT NOT NULL,
        authorized_by TEXT NOT NULL,
        key_algorithm TEXT NOT NULL DEFAULT 'ed25519'
      );
    `);
  }

  async isAuthorized(agentKeyId: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT 1 as hit FROM authorized_agents WHERE agent_key_id = ? AND active = 1")
      .get(agentKeyId);
    return row !== undefined;
  }

  async list(): Promise<AuthorizedAgent[]> {
    const rows = this.db
      .prepare("SELECT * FROM authorized_agents ORDER BY authorized_at DESC")
      .all();
    return rows.map(rowToAuthorizedAgent);
  }

  async grant(input: GrantAuthorizedAgentInput): Promise<void> {
    const authorizedAt = new Date().toISOString();
    this.db
      .prepare(GRANT_SQL)
      .run(
        input.agentKeyId,
        input.signatureAgentUrl,
        input.displayName,
        authorizedAt,
        input.authorizedBy,
        input.keyAlgorithm ?? "ed25519"
      );
  }

  async revoke(agentKeyId: string): Promise<void> {
    this.db
      .prepare("UPDATE authorized_agents SET active = 0 WHERE agent_key_id = ?")
      .run(agentKeyId);
  }

  close(): void {
    this.db.close();
  }
}

/** Implementacion en memoria -- util para tests. Nunca autoriza nada por
 * defecto; hay que agregar explicitamente los agentKeyId de prueba. */
export class InMemoryAuthorizedAgentsStore implements AuthorizedAgentsStore {
  private agents = new Map<string, AuthorizedAgent>();

  constructor(authorizedKeyIds: Set<string> = new Set()) {
    const now = new Date().toISOString();
    for (const agentKeyId of authorizedKeyIds) {
      this.agents.set(agentKeyId, {
        agentKeyId,
        signatureAgentUrl: "",
        displayName: agentKeyId,
        active: true,
        authorizedAt: now,
        authorizedBy: "test-seed",
        keyAlgorithm: "ed25519",
      });
    }
  }

  async isAuthorized(agentKeyId: string): Promise<boolean> {
    return this.agents.get(agentKeyId)?.active === true;
  }

  async list(): Promise<AuthorizedAgent[]> {
    return [...this.agents.values()];
  }

  async grant(input: GrantAuthorizedAgentInput): Promise<void> {
    this.agents.set(input.agentKeyId, {
      agentKeyId: input.agentKeyId,
      signatureAgentUrl: input.signatureAgentUrl,
      displayName: input.displayName,
      active: true,
      authorizedAt: new Date().toISOString(),
      authorizedBy: input.authorizedBy,
      keyAlgorithm: input.keyAlgorithm ?? "ed25519",
    });
  }

  async revoke(agentKeyId: string): Promise<void> {
    const existing = this.agents.get(agentKeyId);
    if (existing) existing.active = false;
  }
}

export interface AuthorizedAgentsFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createAuthorizedAgentsStore(
  env: AuthorizedAgentsFactoryEnv
): Promise<AuthorizedAgentsStore> {
  if (env.DB) {
    return new D1AuthorizedAgentsStore(env.DB as any);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return SqliteAuthorizedAgentsStore.open(env.PORTALESS_SQLITE_PATH);
  }
  console.warn("[Portaless AuthorizedAgents] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria (sin agentes autorizados).");
  return new InMemoryAuthorizedAgentsStore();
}
