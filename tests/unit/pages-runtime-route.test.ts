// functions/pages/[slug].js — Phase 0.5: servir /pages/<slug> desde
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
import { onRequestGet } from "../../functions/pages/[slug].js";
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
  await store.save({
    version: "0.1",
    slug: "pagina-con-tema",
    title: "Pagina Con Tema",
    theme: "2pac-dark",
    root: [{ id: "n1", type: "Paragraph", props: { text: "Tema aplicado en runtime." } }],
  } as unknown as PageLayout);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(slug: string, options: { env?: Record<string, unknown>; nextBody?: string } = {}) {
  let nextCalled = 0;
  const context = {
    request: new Request(`http://x.test/pages/${slug}`),
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

describe("GET /pages/:slug (runtime dinamico)", () => {
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
    expect(html).toContain('rel="canonical" href="http://x.test/pages/desde-la-base"');
    expect(html).toContain("application/ld+json");
  });

  it("el shell runtime trae el header/footer del ecosistema y el listener de compartir", async () => {
    // Paridad con lo que emite el build estatico (BaseLayout/Header/
    // Footer): la pagina servida desde la base no puede tener otro
    // header ni otro footer que la estatica.
    const { context } = ctx("desde-la-base");
    const html = await (await onRequestGet(context)).text();

    expect(html).toContain(">Publicaciones<");
    expect(html).not.toMatch(/>Blog</);
    expect(html).toContain(">TrustScore<");
    expect(html).toContain(">Explorar<"); // footer i18n: SITE_LANG=es
    expect(html).toContain("Powered by Portaless");
    expect(html).not.toContain("Hecho con");
    expect(html).toContain("[data-portaless-share]");
    expect(html).toContain('lang="es"');
    // pagina sin theme: el tag <html> nunca lleva el atributo del tema por
    // pagina. (El string "data-theme-pack" SI aparece en el documento: el shell
    // inlinea global.css, que tiene selectores [data-theme-pack="..."]; lo que
    // se verifica es el atributo, no la subcadena.)
    expect(html).toMatch(/<html lang="es">/);
    expect(html).not.toMatch(/<html[^>]*data-theme-pack/);
  });

  it("pagina con theme: variables inline en <html> y nunca como regla de hoja", async () => {
    const { context } = ctx("pagina-con-tema");
    const html = await (await onRequestGet(context)).text();

    // Estilo inline en la propia etiqueta <html>: gana a cualquier regla
    // de hoja (global.css y su @media oscuro se cargan despues en este
    // shell), sin depender de orden ni de !important.
    expect(html).toMatch(
      /<html lang="es" data-theme-pack="2pac-dark" style="[^"]*--accent:#F05D23[^"]*--bg:#14100C/
    );
    expect(html).not.toContain(":root[data-theme-pack]");
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
