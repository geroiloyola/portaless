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
// completo a los no listados -- eso requeriria un cambio en como se
// calcula/expone el snapshot, fuera de alcance de este commit.
//
// key_algorithm (v0.0.9.24): columna agregada por crypto-agilidad, NO
// por soporte real de un segundo algoritmo. Ed25519 (el unico que
// web-bot-auth.ts verifica hoy) es vulnerable a computadoras cuanticas.
// Guardar el algoritmo junto a cada fila desde ahora evita una
// migracion de datos con filas reales ya en produccion en sitios de
// terceros el dia que se agregue verificacion ML-DSA (FIPS 204, ya
// estandarizado por NIST). Ver "Crypto-agilidad" en
// docs/architecture/site-trust-score.md.
//
// RESUELTO (verificado esta sesion): schema.sql (raiz, usado para D1)
// SI tiene `key_algorithm TEXT NOT NULL DEFAULT 'ed25519'` en la
// definicion de authorized_agents -- no hubo asimetria real entre el
// esquema de SQLite y el de D1, era informacion desactualizada.
//
// grant/revoke/list (esta sesion): hasta ahora la UNICA forma de dar de
// alta un agente era scripts/onboard-agent.mjs, un CLI que escribe
// directo contra SQLite via node:sqlite -- sin ningun camino para D1,
// y sin posibilidad de exponerlo desde un endpoint HTTP/UI de admin.
// Se agregan estos 3 metodos a la interfaz (aditivo, no rompe a
// agent-verification.js, el unico consumidor existente, que solo usa
// isAuthorized) para que un endpoint bajo functions/admin/ pueda dar de
// alta, revocar, y listar agentes sin pasar por el CLI. revoke() hace
// soft-delete (active = 0) en vez de DELETE, coherente con que
// isAuthorized ya filtra por active = 1 -- se preserva el historial de
// quien fue autorizado y cuando, igual que el resto del Trust Layer
// (ver ledger de uso, nunca borra filas).

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
      .prepare(
        `INSERT INTO authorized_agents
           (agent_key_id, signature_agent_url, display_name, active, authorized_at, authorized_by, key_algorithm)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(agent_key_id) DO UPDATE SET
           signature_agent_url = excluded.signature_agent_url,
           display_name = excluded.display_name,
           active = 1,
           authorized_at = excluded.authorized_at,
           authorized_by = excluded.authorized_by,
           key_algorithm = excluded.key_algorithm`
      )
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

  constructor(dbPath: string) {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      throw new Error("node:sqlite no esta disponible. Requiere Node 22.5+.");
    }
    this.db = new DatabaseSync(dbPath);
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
      .prepare(
        `INSERT INTO authorized_agents
           (agent_key_id, signature_agent_url, display_name, active, authorized_at, authorized_by, key_algorithm)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(agent_key_id) DO UPDATE SET
           signature_agent_url = excluded.signature_agent_url,
           display_name = excluded.display_name,
           active = 1,
           authorized_at = excluded.authorized_at,
           authorized_by = excluded.authorized_by,
           key_algorithm = excluded.key_algorithm`
      )
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
    try {
      return new SqliteAuthorizedAgentsStore(env.PORTALESS_SQLITE_PATH);
    } catch (err) {
      console.warn(`[Portaless AuthorizedAgents] SQLite no disponible (${(err as Error).message}). Usando memoria (sin agentes autorizados).`);
    }
  } else {
    console.warn("[Portaless AuthorizedAgents] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria (sin agentes autorizados).");
  }

  return new InMemoryAuthorizedAgentsStore();
}
