// Phase 6 — publication maturity: /llms.txt con las paginas de la base.
// El server de browser tests sirve las functions REALES (incluida
// functions/llms.txt.js) sobre SQLite temporal + el build dist/ -- el
// flujo real de self-host, no un mock.
//
// Criterio: una pagina creada desde el editor (PUT /admin/pages/:slug,
// la misma tabla que usa el visitor en /pages/<slug>) aparece listada
// en /llms.txt en el request siguiente, sin publish ni rebuild, y el
// contenido del build (posts y paginas estaticas) sigue intacto.
//
// Nota: en GitHub Pages no hay functions, asi que /llms.txt es el archivo
// del build y solo lista src/content/pages/*.json -- mismo limite
// documentado que /pages/[slug]. Este spec cubre el camino con base.

import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

const SLUG = "paginas-desde-la-base-e2e";
const TITLE = "Pagina Desde La Base E2E";

function layout() {
  return {
    version: "0.1",
    slug: SLUG,
    title: TITLE,
    description: "Creada desde el editor, listada para agentes.",
    root: [{ id: "h1", type: "Heading", props: { text: "Contenido dinamico", level: "h1", align: "center" } }],
  };
}

async function putPage(page: Page): Promise<void> {
  const res = await page.evaluate(async ({ slug, json }) => {
    const current = await fetch(`/admin/pages/${encodeURIComponent(slug)}`);
    const currentEtag = current.ok ? current.headers.get("etag") : null;
    const r = await fetch(`/admin/pages/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(currentEtag ? { "if-match": currentEtag } : { "if-none-match": "*" }),
      },
      body: JSON.stringify(json),
    });
    return r.status;
  }, { slug: SLUG, json: layout() });
  expect(res).toBe(200);
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await page.evaluate(async (slug) => {
    await fetch(`/admin/pages/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }, SLUG);
  await page.close();
});

test("una pagina de la base aparece en /llms.txt sin publish ni rebuild", async ({ page }) => {
  // Antes de crearla, el build estatico no la conoce.
  const before = await page.request.get("/llms.txt");
  expect(before.ok()).toBe(true);
  expect(await before.text()).not.toContain(SLUG);

  await login(page);
  await putPage(page);

  const after = await page.request.get("/llms.txt");
  expect(after.ok()).toBe(true);
  expect(after.headers()["content-type"]).toContain("text/plain");
  const text = await after.text();

  // La pagina de la base, en su propia seccion, con la URL publica.
  expect(text).toContain("## Páginas del editor");
  expect(text).toContain(`- [${TITLE}](http://127.0.0.1:4173/pages/${SLUG})`);
  expect(text).toContain("Creada desde el editor, listada para agentes.");

  // El contenido del build sigue listado (el merge no reemplaza nada).
  expect(text).toContain("## Posts");
  expect(text).toContain("# ");
});
