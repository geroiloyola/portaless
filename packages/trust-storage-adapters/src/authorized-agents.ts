import { openSqlite } from "@portaless/sqlite-driver";
import {
  InMemoryAuthorizedAgentsStore,
  type AuthorizedAgent,
  type AuthorizedAgentsStore,
  type D1DatabaseLike,
  type GrantAuthorizedAgentInput,
} from "@verared/trust-layer/site-trust";

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

