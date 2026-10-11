// Tests del nonce-store anti-replay de Web Bot Auth (v0.0.9.31). El punto
// del store es que la deteccion de replay sea COMPARTIDA entre instancias:
// hasta ahora los nonces vivian en un Map por proceso, y con multiples
// workers (Cloudflare Pages replica, dos instancias Docker, etc.) un
// replay del mismo nonce contra OTRA instancia pasaba. Por eso los tests
// clave abren DOS instancias sobre la MISMA base (SQLite real via
// better-sqlite3 en un archivo temporal, y un D1 fake construido sobre
// better-sqlite3 con la forma prepare/bind/run/first) y comprueban que la
// segunda instancia ve el nonce de la primera. Ver
// packages/trust-layer/src/webbotauth/nonce-store.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryWebBotAuthNonceStore,
  SqliteWebBotAuthNonceStore,
  D1WebBotAuthNonceStore,
  createWebBotAuthNonceStore,
  __resetNonceStoreFactoryForTests,
} from "../../packages/trust-layer/src/webbotauth/nonce-store";
import { openSqlite } from "../../packages/sqlite-driver/src/open";

const TTL = 300_000;

describe("InMemoryWebBotAuthNonceStore", () => {
  it("acepta el primer uso de un nonce y lo marca como replay en el segundo", async () => {
    const store = new InMemoryWebBotAuthNonceStore();
    expect(await store.registerIfUnseen("n-1", 0, TTL)).toBe(true);
    expect(await store.registerIfUnseen("n-1", 1, TTL)).toBe(false);
  });

  it("pasado el TTL el mismo nonce vuelve a ser aceptable (el vencido se borra)", async () => {
    const store = new InMemoryWebBotAuthNonceStore();
    expect(await store.registerIfUnseen("n-2", 0, TTL)).toBe(true);
    expect(await store.registerIfUnseen("n-2", TTL - 1, TTL)).toBe(false); // dentro de la ventana
    expect(await store.registerIfUnseen("n-2", TTL, TTL)).toBe(true); // en el borde ya vencio
  });

  it("nonces distintos no se pisan", async () => {
    const store = new InMemoryWebBotAuthNonceStore();
    expect(await store.registerIfUnseen("a", 0, TTL)).toBe(true);
    expect(await store.registerIfUnseen("b", 0, TTL)).toBe(true);
  });

  it("clear() vacia todo (solo para tests)", async () => {
    const store = new InMemoryWebBotAuthNonceStore();
    await store.registerIfUnseen("n-3", 0, TTL);
    store.clear();
    expect(await store.registerIfUnseen("n-3", 1, TTL)).toBe(true);
  });
});

describe("SqliteWebBotAuthNonceStore (SQLite real, archivo temporal)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pless-nonce-store-"));
    dbPath = join(dir, "portaless-test.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acepta el primer uso, detecta replay y libera el nonce tras el TTL", async () => {
    const store = new SqliteWebBotAuthNonceStore(await openSqlite(dbPath));
    expect(await store.registerIfUnseen("n-1", 0, TTL)).toBe(true);
    expect(await store.registerIfUnseen("n-1", 1, TTL)).toBe(false);
    expect(await store.registerIfUnseen("n-1", TTL + 1, TTL)).toBe(true);
  });

  it("DOS instancias sobre el MISMO archivo comparten la ventana (replay cross-instance)", async () => {
    const workerA = new SqliteWebBotAuthNonceStore(await openSqlite(dbPath));
    const workerB = new SqliteWebBotAuthNonceStore(await openSqlite(dbPath));

    expect(await workerA.registerIfUnseen("n-cross", 0, TTL)).toBe(true);
    // workerB es "otro proceso": nunca vio n-cross, pero su INSERT choca con
    // el UNIQUE de la base compartida y lo reporta como replay.
    expect(await workerB.registerIfUnseen("n-cross", 1, TTL)).toBe(false);
  });

  it("dos instancias registran nonces distintos sin interferencia", async () => {
    const workerA = new SqliteWebBotAuthNonceStore(await openSqlite(dbPath));
    const workerB = new SqliteWebBotAuthNonceStore(await openSqlite(dbPath));

    expect(await workerA.registerIfUnseen("de-a", 0, TTL)).toBe(true);
    expect(await workerB.registerIfUnseen("de-b", 0, TTL)).toBe(true);
    expect(await workerA.registerIfUnseen("de-b", 0, TTL)).toBe(false); // ahora compartido
  });
});

describe("D1WebBotAuthNonceStore (D1 fake sobre better-sqlite3)", () => {
  let dir: string;
  let dbPath: string;
  let db: any;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pless-nonce-d1-"));
    dbPath = join(dir, "portaless-test.db");
  });

  afterEach(() => {
    db?.close();
    db = null;
    rmSync(dir, { recursive: true, force: true });
  });

  // Fake D1DatabaseLike con la forma que usa el store (prepare().bind()
  // .run()/.first()) construido sobre better-sqlite3: asi el UNIQUE de
  // SQLite se ejercita de verdad, igual que en un D1 real.
  function fakeD1(database: any) {
    return {
      prepare(sql: string) {
        const stmt = database.prepare(sql);
        return {
          bind(...args: unknown[]) {
            return {
              run: async () => {
                stmt.run(...(args as never[]));
                return { success: true };
              },
              first: async () => stmt.get(...(args as never[])) ?? null,
            };
          },
        };
      },
    };
  }

  it("crea la tabla con ensure() y hace el ciclo true/replay/expirado", async () => {
    db = await openSqlite(dbPath);
    const store = new D1WebBotAuthNonceStore(fakeD1(db));

    expect(await store.registerIfUnseen("n-1", 0, TTL)).toBe(true);
    expect(await store.registerIfUnseen("n-1", 1, TTL)).toBe(false);
    expect(await store.registerIfUnseen("n-1", TTL + 1, TTL)).toBe(true);

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webbotauth_nonces'").get();
    expect(table).toBeTruthy();
  });

  it("DOS stores D1 sobre la MISMA base comparten la ventana (replay cross-instance)", async () => {
    db = await openSqlite(dbPath);
    const workerA = new D1WebBotAuthNonceStore(fakeD1(db));
    const workerB = new D1WebBotAuthNonceStore(fakeD1(db));

    expect(await workerA.registerIfUnseen("n-cross", 0, TTL)).toBe(true);
    expect(await workerB.registerIfUnseen("n-cross", 1, TTL)).toBe(false);
  });

  it("un fallo real de la base se propaga en vez de fingirse un replay", async () => {
    // Fake roto: el INSERT revienta con un error que NO es de constraint y
    // el SELECT de confirmacion no encuentra nada -> el store re-lanza.
    const brokenDb = {
      prepare(sql: string) {
        if (sql.startsWith("INSERT")) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error("disk I/O error");
              },
              first: async () => null,
            }),
          };
        }
        if (sql.startsWith("SELECT")) {
          return {
            bind: () => ({
              run: async () => ({}),
              first: async () => null,
            }),
          };
        }
        return { bind: () => ({ run: async () => ({}), first: async () => null }) };
      },
    };
    const store = new D1WebBotAuthNonceStore(brokenDb as never);
    await expect(store.registerIfUnseen("n-err", 0, TTL)).rejects.toThrow("disk I/O error");
  });
});

describe("createWebBotAuthNonceStore (factory)", () => {
  let dir: string;

  beforeEach(() => {
    __resetNonceStoreFactoryForTests();
    dir = mkdtempSync(join(tmpdir(), "pless-nonce-factory-"));
  });

  afterEach(() => {
    __resetNonceStoreFactoryForTests();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("con env.DB devuelve el store D1", async () => {
    const store = await createWebBotAuthNonceStore({ DB: { fake: true } });
    expect(store).toBeInstanceOf(D1WebBotAuthNonceStore);
  });

  it("con PORTALESS_SQLITE_PATH devuelve el store SQLite y cachea la instancia por path", async () => {
    const dbPath = join(dir, "portaless-test.db");
    const first = await createWebBotAuthNonceStore({ PORTALESS_SQLITE_PATH: dbPath });
    const second = await createWebBotAuthNonceStore({ PORTALESS_SQLITE_PATH: dbPath });
    expect(first).toBeInstanceOf(SqliteWebBotAuthNonceStore);
    expect(second).toBe(first);
  });

  it("sin DB ni PORTALESS_SQLITE_PATH cae a memoria CON warning (nunca en silencio)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await createWebBotAuthNonceStore({});
    expect(store).toBeInstanceOf(InMemoryWebBotAuthNonceStore);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("PORTALESS_SQLITE_PATH");
  });
});
