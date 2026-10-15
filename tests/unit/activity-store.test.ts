// Feed de actividad (Fase 10): store D1/SQLite/InMemory, el unico escritor
// emitActivity() y el endpoint GET /admin/api/recents (admin-only).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  D1ActivityStore,
  InMemoryActivityStore,
  createActivityStore,
  emitActivity,
} from "../../packages/dashboard/src/activity/activity-store";
import * as endpoint from "../../functions/admin/api/recents";

const tmp = mkdtempSync(join(tmpdir(), "portaless-activity-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// D1 fake sobre better-sqlite3: mismo contrato que el D1 real (prepare/bind/
// run/first/all) para ejercitar D1ActivityStore sin un binding remoto.
function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => ({ success: true, meta: { changes: Number(stmt.run(...(args as never[])).changes) } }),
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

let dbSeq = 0;
function sqliteEnv(): Record<string, unknown> {
  dbSeq += 1;
  return { PORTALESS_SQLITE_PATH: join(tmp, `activity-${dbSeq}.db`) };
}

describe("ActivityStore (InMemory)", () => {
  it("registra y lista con el mas reciente primero", async () => {
    const store = new InMemoryActivityStore();
    await store.record({ kind: "page.saved", subject: "a", occurredAt: "2026-10-15T00:00:00.000Z" });
    await store.record({ kind: "page.deleted", subject: "b", occurredAt: "2026-10-15T00:00:01.000Z" });
    const list = await store.list();
    expect(list.map((e) => e.subject)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ kind: "page.deleted", actor: null, detail: null });
  });

  it("rechaza kind y subject invalidos", async () => {
    const store = new InMemoryActivityStore();
    await expect(store.record({ kind: "Bad Kind", subject: "x" })).rejects.toThrow();
    await expect(store.record({ kind: "page.saved", subject: "" })).rejects.toThrow();
  });

  it("respeta el limite y el actor/detail opcionales", async () => {
    const store = new InMemoryActivityStore();
    for (let i = 0; i < 5; i++) {
      await store.record({ kind: "page.saved", subject: `p${i}`, actor: "admin", detail: `t${i}` });
    }
    const list = await store.list(2);
    expect(list).toHaveLength(2);
    expect(list[0].actor).toBe("admin");
    expect(list[0].detail).toBe("t4");
  });
});

describe("ActivityStore (SQLite)", () => {
  it("persiste entre instancias sobre el mismo archivo", async () => {
    const env = sqliteEnv();
    await (await createActivityStore(env)).record({ kind: "page.saved", subject: "guardada" });
    const list = await (await createActivityStore(env)).list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "page.saved", subject: "guardada" });
  });
});

describe("ActivityStore (D1 fake) + factory", () => {
  it("D1: round-trip y mas reciente primero", async () => {
    const db = new Database(join(tmp, "d1.db"));
    const store = new D1ActivityStore(fakeD1(db));
    await store.record({ kind: "page.saved", subject: "a", occurredAt: "2026-10-15T00:00:00.000Z" });
    await store.record({ kind: "page.deleted", subject: "b", occurredAt: "2026-10-15T00:00:01.000Z" });
    const list = await store.list();
    expect(list.map((e) => e.subject)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ kind: "page.deleted", actor: null, detail: null });
    db.close();
  });

  it("factory: DB -> D1, PORTALESS_SQLITE_PATH -> SQLite, si no InMemory", async () => {
    const db = new Database(join(tmp, "factory.db"));
    expect(await createActivityStore({ DB: fakeD1(db) })).toBeInstanceOf(D1ActivityStore);
    const sqlite = await createActivityStore({ PORTALESS_SQLITE_PATH: join(tmp, "factory-sqlite.db") });
    expect(sqlite).not.toBeInstanceOf(D1ActivityStore);
    expect(await createActivityStore({})).toBeInstanceOf(InMemoryActivityStore);
    db.close();
  });
});

describe("emitActivity: nunca rompe la accion principal", () => {
  it("traga el error del store y resuelve", async () => {
    const brokenD1 = {
      prepare() {
        throw new Error("boom");
      },
    };
    await expect(emitActivity({ DB: brokenD1 }, { kind: "page.saved", subject: "x" })).resolves.toBeUndefined();
  });
});

describe("GET /admin/api/recents", () => {
  function ctx(env: Record<string, unknown>, user: unknown) {
    return {
      request: new Request("http://x.test/admin/api/recents"),
      env,
      data: user ? { user } : {},
    } as any;
  }

  it("401 sin sesion", async () => {
    const res = await endpoint.onRequestGet(ctx(sqliteEnv(), null));
    expect(res.status).toBe(401);
  });

  it("200 devuelve los eventos para un usuario autenticado", async () => {
    const env = sqliteEnv();
    await (await createActivityStore(env)).record({
      kind: "community.attestation",
      actor: "did:apw:veracier.example",
      subject: "default",
      detail: "content_accuracy",
    });
    const res = await endpoint.onRequestGet(ctx(env, { username: "admin", role: "admin" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ kind: "community.attestation", actor: "did:apw:veracier.example" });
  });

  it("clampa el limite pedido por query", async () => {
    const env = sqliteEnv();
    const store = await createActivityStore(env);
    for (let i = 0; i < 3; i++) await store.record({ kind: "page.saved", subject: `p${i}` });
    const res = await endpoint.onRequestGet({
      request: new Request("http://x.test/admin/api/recents?limit=2"),
      env,
      data: { user: { username: "admin" } },
    } as any);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
  });
});
