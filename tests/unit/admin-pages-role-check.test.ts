import { describe, it, expect } from "vitest";
import { onRequestPut, onRequestGet } from "../../functions/admin/pages/[slug].js";

// Mock minimo de D1Database en memoria -- implementa solo lo que
// D1PageStore usa (prepare().bind().first()/run()/all()). Evita que
// createPageStore() caiga al fallback SqlitePageStore, que requiere
// node:sqlite y escribiria un archivo real en disco (./data/pages.sqlite)
// como efecto secundario del test si env.DB fuera undefined. (v0.0.9.3:
// el binding se llama `DB`, no `PORTALESS_DB` -- ver el fix de nombre en
// packages/atomic-elements/src/persistence/store-factory.ts.)
function makeFakeD1() {
  const rows = new Map<string, { slug: string; layout_json: string; updated_at: string; updated_by: string | null }>();
  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return api;
        },
        async first() {
          const [slug] = boundArgs as [string];
          return rows.get(slug) ?? null;
        },
        async run() {
          const [slug, layoutJson, updatedAt, updatedBy] = boundArgs as [string, string, string, string | null];
          rows.set(slug, { slug, layout_json: layoutJson, updated_at: updatedAt, updated_by: updatedBy });
          return { success: true };
        },
        async all() {
          return { results: Array.from(rows.values()).map((r) => ({ slug: r.slug })) };
        },
      };
      return api;
    },
  };
}

function makeContext({ user, slugParam, body }: { user: { role: string } | null; slugParam: string; body?: unknown }) {
  return {
    request: {
      json: async () => body,
    },
    params: { slug: slugParam },
    data: { user },
    env: { DB: makeFakeD1() },
  } as any;
}

describe("functions/admin/pages/[slug].js", () => {
  it("PUT rechaza con 401 si no hay usuario autenticado", async () => {
    const ctx = makeContext({ user: null, slugParam: "inicio" });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(401);
  });

  it("PUT rechaza con 403 a un usuario con rol viewer (aunque este autenticado)", async () => {
    const ctx = makeContext({
      user: { role: "viewer" },
      slugParam: "inicio",
      body: { version: "0.1", slug: "inicio", title: "Inicio", root: [] },
    });
    const res = await onRequestPut(ctx);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("forbidden");
  });

  it("PUT permite a un usuario con rol admin y layout valido", async () => {
    const ctx = makeContext({
      user: { role: "admin" },
      slugParam: "inicio",
      body: { version: "0.1", slug: "inicio", title: "Inicio", root: [] },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(200);
  });

  it("PUT rechaza con 400 si el slug del body no coincide con el de la URL", async () => {
    const ctx = makeContext({
      user: { role: "admin" },
      slugParam: "inicio",
      body: { version: "0.1", slug: "otra-pagina", title: "Otra", root: [] },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });

  it("GET rechaza con 401 si no hay usuario autenticado, pero no exige rol admin", async () => {
    const ctxNoUser = makeContext({ user: null, slugParam: "inicio" });
    const resNoUser = await onRequestGet(ctxNoUser);
    expect(resNoUser.status).toBe(401);

    const ctxViewer = makeContext({ user: { role: "viewer" }, slugParam: "inicio" });
    const resViewer = await onRequestGet(ctxViewer);
    expect(resViewer.status).not.toBe(403);
  });
});
