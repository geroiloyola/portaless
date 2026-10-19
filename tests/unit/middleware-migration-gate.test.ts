// R1: el gate de migraciones del middleware, end-to-end. La falta de este test
// es lo que dejo pasar el bug: un Cloudflare sano (schema.sql aplicado, sin
// libro mayor) recibia 503 en TODO. Aca se ejercita el onRequest real con env
// fake (D1 mock y SQLite inexistente).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { onRequest, __resetMigrationGateForTests } from "../../functions/_middleware";
import { schemaVersion } from "../../packages/persistence-migrations/src/index";

function makeContext(env: Record<string, unknown>, url = "https://site.example/pages/foo") {
  const request = new Request(url);
  const data: Record<string, unknown> = {};
  const next = vi.fn(async () => new Response("PASO-AL-SIGUIENTE", { status: 200 }));
  return { context: { request, env, data, next, params: {} } as any, next };
}

function d1Mock(tables: string[], ledgerRows: Array<[number, string, string]> | null) {
  return {
    prepare(sql: string) {
      const isProbe = /name = \?/.test(sql);
      return {
        bind: (name: string) => ({
            first: async () =>
              tables.includes(name) || (name === "schema_migrations" && ledgerRows !== null) ? { name } : null,
          }),
        first: async () => {
          if (isProbe) return null;
          if (ledgerRows === null) throw new Error("no such table: schema_migrations");
          return { v: ledgerRows.length ? Math.max(...ledgerRows.map((r) => r[0])) : null };
        },
      };
    },
  };
}

beforeEach(() => {
  __resetMigrationGateForTests();
});

describe("middleware: gate de migraciones (R1)", () => {
  it("sin base (hosting estatico) -> pasa al siguiente", async () => {
    const { context, next } = makeContext({});
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PASO-AL-SIGUIENTE");
    expect(next).toHaveBeenCalled();
  });

  it("Cloudflare sano SIN libro mayor -> NO bloquea (regresion R1)", async () => {
    const { context, next } = makeContext({ DB: d1Mock(["users", "pages"], null) });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalled();
  });

  it("Cloudflare con libro atrasado -> 503 pending_database_migrations", async () => {
    const { context, next } = makeContext({ DB: d1Mock(["users"], [[1, "baseline", "t"]]) });
    const res = await onRequest(context);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("pending_database_migrations");
    expect(next).not.toHaveBeenCalled();
  });

  it("Cloudflare con libro al dia -> pasa", async () => {
    const { context, next } = makeContext({ DB: d1Mock(["users"], [[schemaVersion(), "x", "t"]]) });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalled();
  });

  it("base mas nueva que el codigo -> 503 database_newer_than_code", async () => {
    const { context } = makeContext({ DB: d1Mock(["users"], [[schemaVersion() + 5, "future", "t"]]) });
    const res = await onRequest(context);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("database_newer_than_code");
  });

  it("SQLite con path inexistente -> no bloquea (y no crea archivo)", async () => {
    const { context, next } = makeContext({ PORTALESS_SQLITE_PATH: "/nonexistent/dir/x.sqlite" });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalled();
  });
});
