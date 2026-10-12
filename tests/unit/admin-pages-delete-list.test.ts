// Phase 0.5 — page manager minimo. functions/admin/pages/[slug].js
// onRequestDelete (sesion + canWrite + removed booleano, 404 si no
// habia nada) y functions/admin/api/pages.js con los titulos de cada
// pagina (N+1 server-side, mantiene { slugs } por compatibilidad).
// Persistencia real en SQLite temporal, mismo patron que
// sqlite-page-store.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { onRequestDelete } from "../../functions/admin/pages/[slug].js";
import { onRequestGet as listPages } from "../../functions/admin/api/pages.js";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const tmp = mkdtempSync(join(tmpdir(), "portaless-pages-delete-"));
const DB = join(tmp, "portaless.db");
const env = { PORTALESS_SQLITE_PATH: DB };

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  const store = await createPageStore(env);
  await store.save({
    version: "0.1",
    slug: "pagina-borrar",
    title: "Titulo Borrame",
    root: [],
  } as PageLayout);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(opts: { user?: { username: string; role: string } | null; slug?: string } = {}) {
  return {
    request: new Request(`http://x.test/admin/pages/${opts.slug ?? "pagina-borrar"}`, { method: "DELETE" }),
    env,
    params: { slug: opts.slug ?? "pagina-borrar" },
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

const ADMIN = { username: "admin", role: "admin" };
const VIEWER = { username: "v", role: "viewer" };

describe("DELETE /admin/pages/:slug", () => {
  it("401 sin sesion", async () => {
    const res = await onRequestDelete(ctx({ user: null }));
    expect(res.status).toBe(401);
  });

  it("403 rol sin permiso de escritura, la pagina sigue ahi", async () => {
    const res = await onRequestDelete(ctx({ user: VIEWER }));
    expect(res.status).toBe(403);
    const store = await createPageStore(env);
    expect(await store.load("pagina-borrar")).not.toBeNull();
  });

  it("200 admin: removed true y la pagina desaparece del store", async () => {
    const res = await onRequestDelete(ctx({ user: ADMIN }));
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    const store = await createPageStore(env);
    expect(await store.load("pagina-borrar")).toBeNull();
  });

  it("404 al borrar dos veces: removed false, sin error de red", async () => {
    const res = await onRequestDelete(ctx({ user: ADMIN }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.removed).toBe(false);
    expect(body.error).toBe("not_found");
  });
});

describe("GET /admin/pages (listado con titulos)", () => {
  it("401 sin sesion", async () => {
    const res = await listPages(ctx({ user: null }));
    expect(res.status).toBe(401);
  });

  it("devuelve slugs (compat) y pages [{slug,title}]", async () => {
    const store = await createPageStore(env);
    await store.save({
      version: "0.1",
      slug: "listada",
      title: "La Listada",
      root: [],
    } as PageLayout);

    const res = await listPages(ctx({ user: VIEWER }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slugs).toContain("listada");
    expect(body.pages).toEqual(expect.arrayContaining([{ slug: "listada", title: "La Listada" }]));
    // La pagina borrada en el test anterior ya no figura.
    expect(body.slugs).not.toContain("pagina-borrar");

    await store.remove("listada");
  });
});
