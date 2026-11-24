// Portaless node SQLite/D1 storage adapters for Web Bot Auth anti-replay nonces (Node-L0).
import { openSqlite } from "@portaless/sqlite-driver";
import {
  InMemoryWebBotAuthNonceStore,
  NONCES_DDL,
  type WebBotAuthNonceStore,
} from "@verared/trust-layer";

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
      if (row) return false;
      throw err;
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
      this.db
        .prepare("INSERT INTO webbotauth_nonces (nonce, expires_at) VALUES (?, ?)")
        .run(nonce, nowMs + ttlMs);
      return true;
    } catch (err) {
      const row = this.db
        .prepare("SELECT nonce FROM webbotauth_nonces WHERE nonce = ? AND expires_at > ?")
        .get(nonce, nowMs);
      if (row) return false;
      throw err;
    }
  }
}

export interface NonceStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

let cachedSqliteStore: SqliteWebBotAuthNonceStore | null = null;
let cachedInMemoryStore: InMemoryWebBotAuthNonceStore | null = null;
const cachedD1Stores = new WeakMap<object, D1WebBotAuthNonceStore>();

export async function createWebBotAuthNonceStore(
  env: NonceStoreFactoryEnv,
): Promise<WebBotAuthNonceStore> {
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
      cachedSqliteStore = new SqliteWebBotAuthNonceStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
    }
    return cachedSqliteStore;
  }

  console.warn(
    "[Portaless WebBotAuth] Sin DB ni PORTALESS_SQLITE_PATH -- nonces anti-replay en memoria. " +
      "Sin estado compartido entre instancias: un replay contra OTRO proceso no se detecta. " +
      "Configura D1 (env.DB) o PORTALESS_SQLITE_PATH en produccion.",
  );

  if (!cachedInMemoryStore) cachedInMemoryStore = new InMemoryWebBotAuthNonceStore();
  return cachedInMemoryStore;
}

export function __resetNonceStoreFactoryForTests(): void {
  cachedSqliteStore = null;
  cachedInMemoryStore = null;
}
