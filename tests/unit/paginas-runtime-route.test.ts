// functions/paginas/[slug].js — Phase 0.5: servir /paginas/<slug> desde
// la base al instante. Cubre: hit en la base -> 200 HTML con title,
// contenido renderizado, tokens del skin y canonical; miss -> delega al
// build estatico via context.next(); layout corrupto (tipo de elemento
// desconocido, version mala) -> next() en vez de 500 en una pagina
// publica; error de lectura de la base -> next().

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { onRequestGet } from "../../functions/paginas/[slug].js";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const tmp = mkdtempSync(join(tmpdir(), "portaless-paginas-route-"));
const DB = join(tmp, "portaless.db");
const env = { PORTALESS_SQLITE_PATH: DB };

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  const store = await createPageStore(env);
  await store.save({
    version: "0.1",
    slug: "desde-la-base",
    title: "Pagina Desde La Base",
    description: "Descripcion dinamica",
    root: [
      { id: "n1", type: "Heading", props: { text: "Hola runtime", level: "h1", align: "center" } },
      { id: "n2", type: "Paragraph", props: { text: "Contenido servido desde la tabla pages." } },
    ],
  } as unknown as PageLayout);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(slug: string, options: { env?: Record<string, unknown>; nextBody?: string } = {}) {
  let nextCalled = 0;
  const context = {
    request: new Request(`http://x.test/paginas/${slug}`),
    env: options.env ?? env,
    params: { slug },
    data: {},
    next: async () => {
      nextCalled += 1;
      return new Response(options.nextBody ?? "STATIC-FALLBACK", { status: 404 });
    },
  } as any;
  return { context, nextCalls: () => nextCalled };
}

describe("GET /paginas/:slug (runtime dinamico)", () => {
  it("hit en la base: 200 HTML con title, contenido y tokens del skin", async () => {
    const { context } = ctx("desde-la-base");
    const res = await onRequestGet(context);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Pagina Desde La Base</title>");
    expect(html).toContain("Hola runtime");
    expect(html).toContain("Contenido servido desde la tabla pages.");
    expect(html).toContain('class="ae-page"');
    expect(html).toContain('href="/api/site-skin"');
    expect(html).toMatch(/--accent:\s*#C5D86D/); // global.css o fallback inline
    expect(html).toContain('rel="canonical" href="http://x.test/paginas/desde-la-base"');
    expect(html).toContain("application/ld+json");
  });

  it("miss en la base: delega al build estatico con next()", async () => {
    const { context, nextCalls } = ctx("no-existe");
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("STATIC-FALLBACK");
  });

  it("layout corrupto (tipo desconocido) en la base: next() en vez de 500", async () => {
    // Escritura cruda: los stores validan al guardar (save lanza), este
    // caso simula una fila legacy/hand-crafted con elemento desconocido.
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(DB);
    db.prepare("INSERT OR REPLACE INTO pages (slug, layout_json, updated_at) VALUES (?, ?, datetime('now'))").run(
      "corrupta",
      JSON.stringify({ version: "0.1", slug: "corrupta", title: "Corrupta", root: [{ id: "x", type: "ElementoInventado", props: {} }] })
    );
    db.close();

    const { context, nextCalls } = ctx("corrupta");
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(await res.text()).toBe("STATIC-FALLBACK");

    const store = await createPageStore(env);
    await store.remove("corrupta");
  });

  it("slug con traversal no toca la base: next()", async () => {
    const { context, nextCalls } = ctx("../etc");
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(await res.text()).toBe("STATIC-FALLBACK");
  });

  it("si la base falla (env roto), la pagina publica nunca es 500", async () => {
    const brokenEnv = { PORTALESS_SQLITE_PATH: join(tmp, "no", "mkdirs", "x.db") };
    // openSqlite lanza si el directorio no existe -> el catch delega.
    const { context, nextCalls } = ctx("cualquiera", { env: brokenEnv });
    const res = await onRequestGet(context);
    expect(nextCalledSafe(nextCalls)).toBe(true);
    expect(await res.text()).toBe("STATIC-FALLBACK");
  });
});

function nextCalledSafe(nextCalls: () => number): boolean {
  return nextCalls() >= 1;
}
