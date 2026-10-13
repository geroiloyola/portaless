// Phase 6: llms.txt con las paginas editadas en la base (D1/SQLite).
// Cubre la fusion pura (dedupe por slug, seccion antes de Optional,
// politica bloqueada manda) y la funcion runtime (fusiona cuando hay base,
// delega al build estatico cuando no la hay o esta vacia).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import {
  AI_INPUT_BLOCKED_MARKER,
  appendLlmsTxtSection,
  buildLlmsTxt,
  listedPageSlugs,
  mergeDbPagesIntoLlmsTxt,
} from "../../src/lib/llms-txt.ts";
import { onRequestGet } from "../../functions/llms.txt.js";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const BASE = buildLlmsTxt({
  siteName: "Mi sitio",
  summary: "Resumen",
  sections: [
    { heading: "Posts", links: [{ title: "Hola", url: "https://a.com/blog/hola.md" }] },
    { heading: "Páginas", links: [{ title: "Términos", url: "https://a.com/paginas/terminos" }] },
  ],
  optional: [{ title: "Feed RSS del blog", url: "https://a.com/rss.xml" }],
});

const toUrl = (slug: string) => `https://a.com/paginas/${slug}`;

describe("listedPageSlugs", () => {
  it("extrae los slugs ya listados en /paginas/<slug>", () => {
    expect([...listedPageSlugs(BASE)]).toEqual(["terminos"]);
    expect([...listedPageSlugs("# S\n")]).toEqual([]);
  });
});

describe("appendLlmsTxtSection", () => {
  it("inserta la seccion antes de ## Optional y respeta el formato", () => {
    const out = appendLlmsTxtSection(BASE, {
      heading: "Páginas del editor",
      links: [{ title: "Contacto", url: toUrl("contacto"), note: "Formulario" }],
    });
    expect(out).toContain("## Páginas del editor\n\n- [Contacto](https://a.com/paginas/contacto): Formulario\n\n## Optional");
    expect(out.trimEnd().endsWith("## Optional")).toBe(false);
    expect(out.endsWith("## Optional\n\n- [Feed RSS del blog](https://a.com/rss.xml)\n")).toBe(true);
  });

  it("sin Optional va al final", () => {
    const out = appendLlmsTxtSection("# S\n", { heading: "X", links: [{ title: "a", url: "https://a.com/a" }] });
    expect(out).toBe("# S\n\n## X\n\n- [a](https://a.com/a)\n");
  });

  it("seccion vacia deja el texto igual (comparable con ===)", () => {
    expect(appendLlmsTxtSection(BASE, { heading: "X", links: [] })).toBe(BASE);
  });
});

describe("mergeDbPagesIntoLlmsTxt", () => {
  it("agrega las paginas de la base que no esten en el build", () => {
    const out = mergeDbPagesIntoLlmsTxt(
      BASE,
      [
        { slug: "contacto", title: "Contacto", description: "Escribime" },
        { slug: "terminos", title: "Términos" },
        { slug: "sin-titulo" },
      ],
      toUrl
    );
    expect(out).toContain("- [Contacto](https://a.com/paginas/contacto): Escribime");
    expect(out).toContain("- [sin-titulo](https://a.com/paginas/sin-titulo)");
    // Dedupe: "terminos" ya lo listaba el build, no se repite.
    expect(out.match(/\/paginas\/terminos/g)?.length).toBe(1);
    // Sin titulo usa el slug como texto del link.
    expect(out).toContain("- [sin-titulo]");
  });

  it("si la politica bloquea ai_input no agrega nada", () => {
    const blocked = buildLlmsTxt({ siteName: "S", sections: [], aiInputAllowed: false });
    expect(blocked).toContain(AI_INPUT_BLOCKED_MARKER);
    expect(mergeDbPagesIntoLlmsTxt(blocked, [{ slug: "contacto", title: "C" }], toUrl)).toBe(blocked);
  });

  it("ignora slugs vacios y no duplica dentro del propio lote", () => {
    const out = mergeDbPagesIntoLlmsTxt(
      "# S\n",
      [{ slug: "", title: "x" }, { slug: "a", title: "A" }, { slug: "a", title: "A de nuevo" }],
      toUrl
    );
    expect(out.match(/paginas\/a\)/g)?.length).toBe(1);
    expect(out).not.toContain("A de nuevo");
  });
});

// ---------------------------------------------------------------------------
// Funcion runtime
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "portaless-llms-route-"));
const DB = join(tmp, "portaless.db");
const env = { PORTALESS_SQLITE_PATH: DB, PORTALESS_SITE_URL: "https://a.com" };

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  const store = await createPageStore(env);
  await store.save({
    version: "0.1",
    slug: "desde-la-base",
    title: "Pagina Desde La Base",
    description: "Descripcion dinamica",
    root: [{ id: "n1", type: "Heading", props: { text: "Hola", level: "h1", align: "center" } }],
  } as unknown as PageLayout);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(options: { env?: Record<string, unknown>; nextBody?: string; url?: string } = {}) {
  let nextCalled = 0;
  const context = {
    request: new Request(options.url ?? "http://x.test/llms.txt"),
    env: options.env ?? env,
    params: {},
    data: {},
    next: async () => {
      nextCalled += 1;
      return new Response(options.nextBody ?? BASE, { status: 200 });
    },
  } as any;
  return { context, nextCalls: () => nextCalled };
}

describe("GET /llms.txt (runtime dinamico)", () => {
  it("fusiona las paginas de la base sobre el build estatico", async () => {
    const { context } = ctx();
    const res = await onRequestGet(context);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("## Posts"); // lo del build queda igual
    expect(text).toContain("- [Pagina Desde La Base](https://a.com/paginas/desde-la-base): Descripcion dinamica");
    expect(text).toContain("## Optional");
  });

  it("sin base de datos delega al build estatico", async () => {
    const { context, nextCalls } = ctx({ env: { PORTALESS_SQLITE_PATH: join(tmp, "nuevo", "sin-schema.db") } });
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(await res.text()).toBe(BASE);
  });

  it("base vacia delega al build estatico", async () => {
    const empty = join(tmpdir(), `portaless-llms-empty-${Date.now()}.db`);
    await applySchema(empty, { quiet: true });
    const { context, nextCalls } = ctx({ env: { PORTALESS_SQLITE_PATH: empty } });
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    rmSync(empty, { force: true });
  });

  it("politica bloqueada en el build: no se agrega la seccion de la base", async () => {
    const blocked = buildLlmsTxt({ siteName: "S", sections: [], aiInputAllowed: false });
    const { context } = ctx({ nextBody: blocked });
    const res = await onRequestGet(context);
    const text = await res.text();
    expect(text).toBe(blocked);
  });

  it("usa el origen pedido si no hay PORTALESS_SITE_URL", async () => {
    const { context } = ctx({ env: { PORTALESS_SQLITE_PATH: DB }, url: "https://otro.test/llms.txt" });
    const res = await onRequestGet(context);
    expect(await res.text()).toContain("(https://otro.test/paginas/desde-la-base)");
  });
});
