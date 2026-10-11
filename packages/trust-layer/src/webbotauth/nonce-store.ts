// Anti-replay por nonce de Web Bot Auth COMPARTIDO entre instancias
// (v0.0.9.31). Hasta ahora los nonces vivian en un Map en memoria por
// proceso (ver la nota que quedaba en verify.ts): con multiples workers
// (Cloudflare Pages replica, dos instancias Docker, etc.) cada proceso
// tenia su propia ventana, y un replay del mismo nonce contra OTRA
// instancia pasaba. Este store lleva el mismo registro a D1/SQLite con
// TTL, siguiendo el patron de auth_mfa_challenges (packages/auth/src/
// stores/d1-ephemeral-auth-store.ts): tabla con nonce como PRIMARY KEY,
// expires_at en epoch ms, los vencidos se borran en cada escritura, y el
// INSERT atomico con UNIQUE es la deteccion de replay -- dos instancias
// concurrentes con el mismo nonce: una inserta, la otra recibe el
// conflicto y responde replay.
//
// Ventana: la misma de siempre, MAX_SIGNATURE_AGE_SECONDS (300 s) --
// el nonce cubre exactamente la vida util de la firma que lo porta.
// Pasado ese tiempo el row vence y el mismo nonce volveria a ser
// aceptable, igual que con el Map en memoria; el replay tardio no tiene
// valor porque la firma misma ya esta vencida (created/expires se
// verifican ANTES del nonce).
//
// Precision sobre errores: si el INSERT falla, se consulta si el row
// existe y esta vivo -- solo entonces es replay. Un fallo real de la
// base se propaga en vez de fingirse un replay (un 401 mintiroso
// esconderia un problema de infraestructura).

export interface WebBotAuthNonceStore {
  /**
   * Registra `nonce` si no existia vivo. Devuelve false si ya se registro
   * antes dentro de su ventana (replay).
   */
  registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean>;
}

export const NONCES_DDL =
  "CREATE TABLE IF NOT EXISTS webbotauth_nonces (" +
  "nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)";

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      first(): Promise<Record<string, unknown> | null>;
    };
  };
}

export class D1WebBotAuthNonceStore implements WebBotAuthNonceStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(NONCES_DDL).bind().run());
  }

  async registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean> {
    await this.ensure();
    await this.db.prepare("DELETE FROM webbotauth_nonces WHERE expires_at <= ?").bind(nowMs).run();
    try {
      await this.db
        .prepare("INSERT INTO webbotauth_nonces (nonce, expires_at) VALUES (?, ?)")
        .bind(nonce, nowMs + ttlMs)
        .run();
      return true;
    } catch (err) {
      const row = await this.db
        .prepare("SELECT nonce FROM webbotauth_nonces WHERE nonce = ? AND expires_at > ?")
        .bind(nonce, nowMs)
        .first();
      if (row) return false; // replay confirmado
      throw err; // fallo real de la base
    }
  }
}

interface SqliteLike {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
  };
  exec(sql: string): unknown;
}

export class SqliteWebBotAuthNonceStore implements WebBotAuthNonceStore {
  constructor(private db: SqliteLike) {
    this.db.exec(NONCES_DDL);
  }

  async registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean> {
    this.db.prepare("DELETE FROM webbotauth_nonces WHERE expires_at <= ?").run(nowMs);
    try {
      this.db.prepare("INSERT INTO webbotauth_nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, nowMs + ttlMs);
      return true;
    } catch (err) {
      const row = this.db
        .prepare("SELECT nonce FROM webbotauth_nonces WHERE nonce = ? AND expires_at > ?")
        .get(nonce, nowMs);
      if (row) return false; // replay confirmado
      throw err; // fallo real de la base
    }
  }
}

/**
 * Fallback en memoria -- solo si ni D1 (env.DB) ni SQLite
 * (env.PORTALESS_SQLITE_PATH) estan configurados. Mismo principio que
 * los demas stores del repo: nunca en silencio (hay warning), y los
 * nonces no sobreviven un restart ni se comparten entre procesos.
 */
export class InMemoryWebBotAuthNonceStore implements WebBotAuthNonceStore {
  private nonces = new Map<string, number>(); // nonce -> expiresAt (epoch ms)

  async registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean> {
    for (const [seen, expiresAt] of this.nonces) {
      if (expiresAt <= nowMs) this.nonces.delete(seen);
    }
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, nowMs + ttlMs);
    return true;
  }

  /** Solo para tests: vacia todos los nonces registrados. */
  clear(): void {
    this.nonces.clear();
  }
}

export interface NonceStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

let cachedSqliteStore: SqliteWebBotAuthNonceStore | null = null;
let cachedInMemoryStore: InMemoryWebBotAuthNonceStore | null = null;
const cachedD1Stores = new WeakMap<object, D1WebBotAuthNonceStore>();

export async function createWebBotAuthNonceStore(env: NonceStoreFactoryEnv): Promise<WebBotAuthNonceStore> {
  if (env.DB) {
    const db = env.DB as object;
    let store = cachedD1Stores.get(db);
    if (!store) {
      store = new D1WebBotAuthNonceStore(env.DB as never);
      cachedD1Stores.set(db, store);
    }
    return store;
  }

  if (env.PORTALESS_SQLITE_PATH) {
    if (!cachedSqliteStore) {
      const { openSqlite } = await import("../../../sqlite-driver/src/open");
      cachedSqliteStore = new SqliteWebBotAuthNonceStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
    }
    return cachedSqliteStore;
  }

  console.warn(
    "[Portaless WebBotAuth] Sin DB ni PORTALESS_SQLITE_PATH -- nonces anti-replay en memoria. " +
      "Sin estado compartido entre instancias: un replay contra OTRO proceso no se detecta. " +
      "Configura D1 (env.DB) o PORTALESS_SQLITE_PATH en produccion."
  );

  if (!cachedInMemoryStore) cachedInMemoryStore = new InMemoryWebBotAuthNonceStore();
  return cachedInMemoryStore;
}

/** Solo para tests: olvida los stores cacheados del factory. */
export function __resetNonceStoreFactoryForTests(): void {
  cachedSqliteStore = null;
  cachedInMemoryStore = null;
}
