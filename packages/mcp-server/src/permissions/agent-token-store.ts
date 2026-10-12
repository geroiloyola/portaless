// Store de tokens de agentes MCP (identidad por invocacion, Opcion B --
// ver AGENT.md y docs/architecture/mcp-agents.md). Cada agente remoto
// que se conecte al servidor MCP via transporte HTTP porta un bearer
// token (`pless_mcp_...`) emitido por el operador; el servidor guarda
// SOLO su hash sha256 (mismo patron que authorized-escrow-providers y
// su api_key_hash) y lo verifica en cada invocacion de tool -- a
// diferencia de la Opcion A (identidad fija desde env por proceso),
// dos tokens distintos son dos identidades con permisos y auditoria
// separados, y revocar el token corta el acceso sin reiniciar nada.
//
// Modelo de rotacion: un solo token ACTIVO por agentKeyId. issue() revoca
// cualquier token previo del mismo agente antes de emitir el nuevo (el
// plaintext se devuelve UNA sola vez en la respuesta de issue; no se
// persiste ni se vuelve a mostrar). revoke() corta por agentKeyId.
//
// La verificacion criptografica tipo Web Bot Auth (firma Ed25519 por
// request) queda fuera de alcance -- esto es un bearer token compartido
// (secreto simetrico), honestamente documentado como tal. Ver
// "Identidad y autenticacion de agentes" en mcp-agents.md.

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface McpAgentTokenRecord {
  agentKeyId: string;
  displayName: string;
  createdAt: string;
  revoked: boolean;
}

export interface IssuedMcpAgentToken {
  /** Plaintext del token -- se devuelve UNA sola vez (en issue()); no se persiste. */
  token: string;
  record: McpAgentTokenRecord;
}

export interface IssuedAgentIdentity {
  agentKeyId: string;
  displayName: string;
}

export interface McpAgentTokenStore {
  /**
   * Emite un token nuevo para `agentKeyId`, revocando primero cualquier
   * token activo previo del mismo agente (rotacion). El plaintext se
   * devuelve solo aqui.
   */
  issue(input: { agentKeyId: string; displayName: string }): Promise<IssuedMcpAgentToken>;
  /** Verifica un bearer token. null = desconocido o revocado. */
  verify(token: string): Promise<IssuedAgentIdentity | null>;
  /** Revoca todos los tokens activos del agente. Devuelve true si habia alguno activo. */
  revoke(agentKeyId: string): Promise<boolean>;
  /** Lista registros (nunca expone hashes ni plaintexts). */
  list(): Promise<McpAgentTokenRecord[]>;
}

export const TOKENS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS mcp_agent_tokens (" +
  "token_hash TEXT PRIMARY KEY, " +
  "agent_key_id TEXT NOT NULL, " +
  "display_name TEXT NOT NULL, " +
  "created_at TEXT NOT NULL, " +
  "revoked INTEGER NOT NULL DEFAULT 0)";

export const TOKENS_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_mcp_agent_tokens_agent_key_id ON mcp_agent_tokens(agent_key_id)";

/** Formato: pless_mcp_ + 32 bytes aleatorios en base64url (43 chars). */
export function generateMcpAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const token = btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/, "");
  return `pless_mcp_${token}`;
}

/** Hash sha256 (hex) con Web Crypto -- funciona igual en Node y en Workers. */
export async function hashMcpAgentToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
}

function rowToRecord(row: Record<string, unknown>): McpAgentTokenRecord {
  return {
    agentKeyId: row.agent_key_id as string,
    displayName: row.display_name as string,
    createdAt: row.created_at as string,
    revoked: Boolean(row.revoked),
  };
}

export class D1McpAgentTokenStore implements McpAgentTokenStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= Promise.all([
      this.db.prepare(TOKENS_TABLE_DDL).bind().run(),
      this.db.prepare(TOKENS_INDEX_DDL).bind().run(),
    ]));
  }

  async issue(input: { agentKeyId: string; displayName: string }): Promise<IssuedMcpAgentToken> {
    await this.ensure();
    const token = generateMcpAgentToken();
    const tokenHash = await hashMcpAgentToken(token);
    const createdAt = new Date().toISOString();
    await this.db
      .prepare("UPDATE mcp_agent_tokens SET revoked = 1 WHERE agent_key_id = ? AND revoked = 0")
      .bind(input.agentKeyId)
      .run();
    await this.db
      .prepare(
        "INSERT INTO mcp_agent_tokens (token_hash, agent_key_id, display_name, created_at, revoked) VALUES (?, ?, ?, ?, 0)"
      )
      .bind(tokenHash, input.agentKeyId, input.displayName, createdAt)
      .run();
    return {
      token,
      record: { agentKeyId: input.agentKeyId, displayName: input.displayName, createdAt, revoked: false },
    };
  }

  async verify(token: string): Promise<IssuedAgentIdentity | null> {
    await this.ensure();
    const tokenHash = await hashMcpAgentToken(token);
    const row = await this.db
      .prepare("SELECT agent_key_id, display_name FROM mcp_agent_tokens WHERE token_hash = ? AND revoked = 0")
      .bind(tokenHash)
      .first<{ agent_key_id: string; display_name: string }>();
    if (!row) return null;
    return { agentKeyId: row.agent_key_id, displayName: row.display_name };
  }

  async revoke(agentKeyId: string): Promise<boolean> {
    await this.ensure();
    const result = await this.db
      .prepare("UPDATE mcp_agent_tokens SET revoked = 1 WHERE agent_key_id = ? AND revoked = 0")
      .bind(agentKeyId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async list(): Promise<McpAgentTokenRecord[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT agent_key_id, display_name, created_at, revoked FROM mcp_agent_tokens ORDER BY created_at DESC")
      .bind()
      .all();
    return results.map(rowToRecord);
  }
}

export class SqliteMcpAgentTokenStore implements McpAgentTokenStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteMcpAgentTokenStore> {
    return new SqliteMcpAgentTokenStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteMcpAgentTokenStore no acepta una ruta en el constructor (mismo cambio v0.0.9.27 que los demas stores). Usa: await SqliteMcpAgentTokenStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`${TOKENS_TABLE_DDL}; ${TOKENS_INDEX_DDL}`);
  }

  async issue(input: { agentKeyId: string; displayName: string }): Promise<IssuedMcpAgentToken> {
    const token = generateMcpAgentToken();
    const tokenHash = await hashMcpAgentToken(token);
    const createdAt = new Date().toISOString();
    this.db.prepare("UPDATE mcp_agent_tokens SET revoked = 1 WHERE agent_key_id = ? AND revoked = 0").run(input.agentKeyId);
    this.db
      .prepare(
        "INSERT INTO mcp_agent_tokens (token_hash, agent_key_id, display_name, created_at, revoked) VALUES (?, ?, ?, ?, 0)"
      )
      .run(tokenHash, input.agentKeyId, input.displayName, createdAt);
    return {
      token,
      record: { agentKeyId: input.agentKeyId, displayName: input.displayName, createdAt, revoked: false },
    };
  }

  async verify(token: string): Promise<IssuedAgentIdentity | null> {
    const tokenHash = await hashMcpAgentToken(token);
    const row = this.db
      .prepare("SELECT agent_key_id, display_name FROM mcp_agent_tokens WHERE token_hash = ? AND revoked = 0")
      .get(tokenHash);
    if (!row) return null;
    return { agentKeyId: row.agent_key_id, displayName: row.display_name };
  }

  async revoke(agentKeyId: string): Promise<boolean> {
    const result = this.db
      .prepare("UPDATE mcp_agent_tokens SET revoked = 1 WHERE agent_key_id = ? AND revoked = 0")
      .run(agentKeyId);
    return (result?.changes ?? 0) > 0;
  }

  async list(): Promise<McpAgentTokenRecord[]> {
    const rows = this.db
      .prepare("SELECT agent_key_id, display_name, created_at, revoked FROM mcp_agent_tokens ORDER BY created_at DESC")
      .all();
    return rows.map(rowToRecord);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Fallback en memoria -- solo si ni D1 (env.DB) ni SQLite
 * (env.PORTALESS_SQLITE_PATH) estan configurados. Mismo principio que
 * los demas stores del repo: nunca en silencio (hay warning), y los
 * tokens no sobreviven un restart.
 */
export class InMemoryMcpAgentTokenStore implements McpAgentTokenStore {
  private records = new Map<string, McpAgentTokenRecord & { tokenHash: string }>();

  async issue(input: { agentKeyId: string; displayName: string }): Promise<IssuedMcpAgentToken> {
    const token = generateMcpAgentToken();
    const tokenHash = await hashMcpAgentToken(token);
    const createdAt = new Date().toISOString();
    for (const rec of this.records.values()) {
      if (rec.agentKeyId === input.agentKeyId) rec.revoked = true;
    }
    this.records.set(tokenHash, {
      tokenHash,
      agentKeyId: input.agentKeyId,
      displayName: input.displayName,
      createdAt,
      revoked: false,
    });
    return {
      token,
      record: { agentKeyId: input.agentKeyId, displayName: input.displayName, createdAt, revoked: false },
    };
  }

  async verify(token: string): Promise<IssuedAgentIdentity | null> {
    const tokenHash = await hashMcpAgentToken(token);
    const rec = this.records.get(tokenHash);
    if (!rec || rec.revoked) return null;
    return { agentKeyId: rec.agentKeyId, displayName: rec.displayName };
  }

  async revoke(agentKeyId: string): Promise<boolean> {
    let hadActive = false;
    for (const rec of this.records.values()) {
      if (rec.agentKeyId === agentKeyId && !rec.revoked) {
        rec.revoked = true;
        hadActive = true;
      }
    }
    return hadActive;
  }

  async list(): Promise<McpAgentTokenRecord[]> {
    return [...this.records.values()]
      .map(({ tokenHash: _tokenHash, ...record }) => record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export interface McpAgentTokenStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

let cachedSqliteStore: SqliteMcpAgentTokenStore | null = null;
let cachedInMemoryStore: InMemoryMcpAgentTokenStore | null = null;
const cachedD1Stores = new WeakMap<object, McpAgentTokenStore>();

export async function createMcpAgentTokenStore(
  env: McpAgentTokenStoreFactoryEnv
): Promise<McpAgentTokenStore> {
  if (env.DB) {
    const db = env.DB as object;
    let store = cachedD1Stores.get(db);
    if (!store) {
      store = new D1McpAgentTokenStore(env.DB as never);
      cachedD1Stores.set(db, store);
    }
    return store;
  }

  if (env.PORTALESS_SQLITE_PATH) {
    if (!cachedSqliteStore) {
      cachedSqliteStore = await SqliteMcpAgentTokenStore.open(env.PORTALESS_SQLITE_PATH);
    }
    return cachedSqliteStore;
  }

  console.warn(
    "[Portaless MCP] Sin DB ni PORTALESS_SQLITE_PATH -- tokens de agentes MCP en memoria. " +
      "Los tokens emitidos no sobreviven un restart. Configura D1 (env.DB) o " +
      "PORTALESS_SQLITE_PATH en produccion."
  );
  if (!cachedInMemoryStore) cachedInMemoryStore = new InMemoryMcpAgentTokenStore();
  return cachedInMemoryStore;
}

/** Solo para tests: olvida los stores cacheados del factory. */
export function __resetMcpAgentTokenStoreFactoryForTests(): void {
  cachedSqliteStore = null;
  cachedInMemoryStore = null;
}
