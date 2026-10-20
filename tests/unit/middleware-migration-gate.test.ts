// R1: el gate de migraciones del middleware, end-to-end. La falta de este test
// es lo que dejo pasar el bug: un Cloudflare sano (schema.sql aplicado, sin
// libro mayor) recibia 503 en TODO. Aca se ejercita el onRequest real con env
// fake (D1 mock y SQLite inexistente).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { onRequest, __resetMigrationGateForTests } from "../../functions/_middleware";
import { MIGRATIONS, REQUIRED_SCHEMA_COLUMNS, schemaVersion } from "../../packages/persistence-migrations/src/index";

function makeContext(env: Record<string, unknown>, url = "https://site.example/pages/foo") {
  const request = new Request(url);
  const data: Record<string, unknown> = {};
  const next = vi.fn(async () => new Response("PASO-AL-SIGUIENTE", { status: 200 }));
  return { context: { request, env, data, next, params: {} } as any, next };
}

function d1Mock(
  tables: string[],
  ledgerRows: Array<[number, string, string]> | null,
  options: { missingColumn?: string; stats?: { masterReads: number }; delay?: boolean } = {},
) {
  const availableTables = new Set([...tables, ...(ledgerRows === null ? [] : ["schema_migrations"])]);
  return {
    prepare(sql: string) {
      if (sql.includes("pragma_table_info")) {
        return {
          bind: (table: string) => ({
            all: async () => ({
              results: availableTables.has(table)
                ? (REQUIRED_SCHEMA_COLUMNS[table] ?? [])
                    .filter((name) => `${table}.${name}` !== options.missingColumn)
                    .map((name) => ({ name }))
                : [],
            }),
          }),
        };
      }
      if (sql.includes("sqlite_master")) {
        return {
          all: async () => {
            if (options.stats) options.stats.masterReads++;
            if (options.delay) await new Promise((resolve) => setTimeout(resolve, 15));
            return { results: [...availableTables].map((name) => ({ name })) };
          },
        };
      }
      return {
        all: async () => ({ results: (ledgerRows ?? []).map(([version, name]) => ({ version, name })) }),
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
    const { context, next } = makeContext({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), null) });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalled();
  });

  it("Cloudflare con libro atrasado -> 503 pending_database_migrations", async () => {
    const { context, next } = makeContext({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), [[1, "baseline", "t"]]) });
    const res = await onRequest(context);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("pending_database_migrations");
    expect(next).not.toHaveBeenCalled();
  });

  it("Cloudflare con libro al dia -> pasa", async () => {
    const rows = MIGRATIONS.map(({ version, name }) => [version, name, "t"] as [number, string, string]);
    const { context, next } = makeContext({ DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), rows) });
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

  it("cachea el estado, no Response: cada request recibe body nuevo", async () => {
    const DB = d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), [[1, "baseline", "t"]]);
    const env = { DB };
    const first = await onRequest(makeContext(env).context);
    const firstBody = await first.json();
    const second = await onRequest(makeContext(env).context);
    const secondBody = await second.json();

    expect(first).not.toBe(second);
    expect(firstBody).toEqual(secondBody);
    expect(secondBody.error).toBe("pending_database_migrations");
  });

  it("coalesce comprobaciones concurrentes para el mismo binding D1", async () => {
    const stats = { masterReads: 0 };
    const DB = d1Mock(["users"], [[1, "baseline", "t"]], { stats, delay: true });
    const env = { DB };
    const first = makeContext(env);
    const second = makeContext(env);
    const [resA, resB] = await Promise.all([onRequest(first.context), onRequest(second.context)]);

    expect(resA.status).toBe(503);
    expect(resB.status).toBe(503);
    expect(stats.masterReads).toBe(2); // una lectura para esquema y otra para ledger
  });

  it("un error leyendo el estado de migración bloquea con 503 y no se cachea como saludable", async () => {
    let reads = 0;
    const DB = {
      prepare() {
        return { all: async () => { reads++; throw new Error("D1 read failed"); } };
      },
    };
    const env = { DB };
    const first = await onRequest(makeContext(env).context);
    expect(first.status).toBe(503);
    expect((await first.json()).error).toBe("migration_status_unavailable");

    const second = await onRequest(makeContext(env).context);
    expect(second.status).toBe(503);
    expect((await second.json()).error).toBe("migration_status_unavailable");
    expect(reads).toBe(4); // dos consultas por intento; errores no reciben TTL de cache
  });

  it("una DB sin columna requerida responde 503 con el contrato incumplido", async () => {
    const { context } = makeContext({
      DB: d1Mock(Object.keys(REQUIRED_SCHEMA_COLUMNS), null, { missingColumn: "users.email" }),
    });
    const response = await onRequest(context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "database_schema_invalid" });
  });
});
