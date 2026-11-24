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

