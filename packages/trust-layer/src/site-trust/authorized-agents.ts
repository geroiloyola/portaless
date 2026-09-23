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
// LIMITACION de este commit: la columna se agrego solo al CREATE TABLE
// de SqliteAuthorizedAgentsStore (via IF NOT EXISTS, no rompe bases ya
// creadas -- pero SQLite tampoco la agrega retroactivamente a una tabla
// existente sin una migracion explicita de ALTER TABLE, no incluida
// aqui). schema.sql (usado para D1) NO se actualizo en este commit --
// no se pudo verificar su contenido exacto con las herramientas
// RESUELTO (verificado esta sesion): schema.sql (raiz, usado para D1)
// SI tiene `key_algorithm TEXT NOT NULL DEFAULT 'ed25519'` en la
// definicion de authorized_agents -- no hubo asimetria real entre el
// esquema de SQLite y el de D1, era informacion desactualizada.

export interface AuthorizedAgentsStore {
  isAuthorized(agentKeyId: string): Promise<boolean>;
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
    };
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
}

/** Implementacion en memoria -- util para tests. Nunca autoriza nada por
 * defecto; hay que agregar explicitamente los agentKeyId de prueba. */
export class InMemoryAuthorizedAgentsStore implements AuthorizedAgentsStore {
  constructor(private authorizedKeyIds: Set<string> = new Set()) {}

  async isAuthorized(agentKeyId: string): Promise<boolean> {
    return this.authorizedKeyIds.has(agentKeyId);
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
