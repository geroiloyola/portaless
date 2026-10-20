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
  const rows = new Map<string, { slug: string; layout_json: string; updated_at: string; updated_by: string | null; publication_id?: string; revision_id?: string; revision_no?: number; content_hash?: string }>();
  const revisions = new Map<string, unknown>();
  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const api = {
        sql,
        args: boundArgs,
        bind(...args: unknown[]) {
          boundArgs = args;
          api.args = args;
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
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      return statements.map(({ sql, args }) => {
        if (sql.startsWith("INSERT INTO pages")) {
          const [slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash] = args as [string, string, string, string | null, string, string, number, string];
          if (rows.has(slug)) return { meta: { changes: 0 } };
          rows.set(slug, { slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE pages")) {
          const [layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash, slug, expected] = args as [string, string, string | null, string, string, number, string, string, string];
          const row = rows.get(slug);
          if (!row || row.revision_id !== expected) return { meta: { changes: 0 } };
          rows.set(slug, { ...row, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO page_revisions")) {
          const [revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by] = args as [string, string, string, number, string | null, string, string, string, string | null, string | null, string | null];
          revisions.set(revision_id, { revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      });
    },
  };
}

function makeContext({ user, slugParam, body, headers = {}, env = { DB: makeFakeD1() } }: { user: { role: string } | null; slugParam: string; body?: unknown; headers?: Record<string, string>; env?: any }) {
  return {
    request: {
      json: async () => body,
      headers: new Headers(headers),
    },
    params: { slug: slugParam },
    data: { user },
    env,
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
      headers: { "if-none-match": "*" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(200);
  });

  it("PUT exige una precondición y rechaza una revisión obsoleta sin sobrescribir", async () => {
    const env = { DB: makeFakeD1() };
    const first = await onRequestPut(makeContext({
      user: { role: "admin" }, slugParam: "inicio",
      body: { version: "0.1", slug: "inicio", title: "v1", root: [] },
      headers: { "if-none-match": "*" }, env,
    }));
    expect(first.status).toBe(200);
    const originalEtag = first.headers.get("etag")!;
    const originalLayout = await (await onRequestGet(makeContext({ user: { role: "admin" }, slugParam: "inicio", env }))).json();

    const update = await onRequestPut(makeContext({
      user: { role: "admin" }, slugParam: "inicio",
      body: { ...originalLayout, title: "v2" },
      headers: { "if-match": originalEtag }, env,
    }));
    expect(update.status).toBe(200);

    const stale = await onRequestPut(makeContext({
      user: { role: "admin" }, slugParam: "inicio",
      body: { ...originalLayout, title: "stale overwrite" },
      headers: { "if-match": originalEtag }, env,
    }));
    expect(stale.status).toBe(409);
    expect((await (await onRequestGet(makeContext({ user: { role: "admin" }, slugParam: "inicio", env }))).json()).title).toBe("v2");

    const missingPrecondition = await onRequestPut(makeContext({
      user: { role: "admin" }, slugParam: "inicio",
      body: { version: "0.1", slug: "inicio", title: "Otra", root: [] },
    }));
    expect(missingPrecondition.status).toBe(428);
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
