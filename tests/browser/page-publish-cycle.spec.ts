// Phase 0.5 — close the edit->publish cycle. Criterio de salida del
// ROADMAP: editar en /admin/editor, publicar, abrir la URL publica y ver
// el cambio en self-host sin terminal y sin rebuild.
//
// El server de browser tests (scripts/browser-test-server.mjs) sirve las
// functions REALES del repo (incluida functions/pages/[slug].js) sobre
// un SQLite temporal + el build dist/ -- es decir, el flujo real de
// self-host, no un mock. workers: 1 y orden serial a proposito: el
// ultimo test borra la pagina que creo para no dejar filas sueltas.
//
// Flujo cubierto:
//   1. login y PUT /admin/pages/:slug (mismo endpoint que el editor);
//   2. la URL publica /pages/<slug> sirve el contenido al instante;
//   3. segundo PUT (edicion) + recarga -> before/after visible sin
//      publish ni rebuild;
//   4. /admin/editor: boton "Publicar" y el link "Ver pagina publica"
//      post-guardado;
//   5. /admin/pages: la pagina aparece con titulo y links Editar/Ver,
//      se borra con confirm() y la URL publica deja de servirla;
//   6. la pagina estatica de src/content sigue intacta (fallback).

import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

const SLUG = "ciclo-browser-e2e";
const TITLE_V1 = "Pagina Ciclo E2E v1";
const TITLE_V2 = "Pagina Ciclo E2E v2 EDITADA";

function layout(title: string, heading: string) {
  return {
    version: "0.1",
    slug: SLUG,
    title,
    root: [
      { id: "h1", type: "Heading", props: { text: heading, level: "h1", align: "center" } },
      { id: "p1", type: "Paragraph", props: { text: "Contenido del ciclo editar-publicar." } },
    ],
  };
}

async function putPage(page: Page, body: unknown): Promise<void> {
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
  }, { slug: SLUG, json: body });
  expect(res).toBe(200);
}

test.afterAll(async ({ browser }) => {
  // Dejar la base sin la pagina del test (idempotente: si ya se borro,
  // DELETE responde 404 y lo ignoramos).
  const page = await browser.newPage();
  await login(page);
  await page.evaluate(async (slug) => {
    await fetch(`/admin/pages/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }, SLUG);
  await page.close();
});

test("ciclo completo: editar -> publicar -> ver publico -> manager -> borrar (sin terminal)", async ({ page }) => {
  await login(page);

  // 1. Publicar la primera version via el mismo endpoint del editor.
  await putPage(page, layout(TITLE_V1, "Hola desde el editor"));

  // 2. La URL publica la sirve el runtime al instante (sin publish).
  await page.goto(`/pages/${SLUG}`);
  await expect(page).toHaveTitle(TITLE_V1);
  await expect(page.locator("h1", { hasText: "Hola desde el editor" })).toBeVisible();
  await expect(page.locator("article.ae-page")).toBeVisible();

  // 3. Editar (segundo PUT) y recargar: before/after sin rebuild.
  await putPage(page, layout(TITLE_V2, "Contenido EDITADO en vivo"));
  await page.reload();
  await expect(page).toHaveTitle(TITLE_V2);
  await expect(page.locator("h1", { hasText: "Contenido EDITADO en vivo" })).toBeVisible();
  const historyLink = page.locator(".public-revision-history a[href^='/revisions/']");
  await expect(historyLink).toBeVisible();
  const historyHref = await historyLink.getAttribute("href");
  const historyResponse = await page.request.get(historyHref!);
  expect(historyResponse.ok()).toBe(true);
  const history = await historyResponse.json();
  expect(history.format).toBe("portaless-public-revision-history/v1");
  expect(history.revisions.map((revision: { title: string }) => revision.title)).toEqual([TITLE_V2, TITLE_V1]);
  expect(history.revisions[0].changedPaths).toContain("title");
  expect(history.revisions[0].reputation).toEqual({ status: "no_data", observations: [] });

  // 4. El editor carga la pagina, "Publicar" guarda y muestra el link
  //    "Ver pagina publica" -- el ciclo se cierra desde la UI.
  await page.goto(`/admin/editor?slug=${SLUG}`);
  await expect(page.locator("#editor-slug-label")).toContainText(SLUG);
  await page.click("#btn-save");
  const viewLink = page.locator("#editor-view-public");
  await expect(viewLink).toBeVisible();
  await expect(viewLink).toHaveAttribute("href", `/pages/${SLUG}`);
  await expect(page.locator(".editor-save-status")).toContainText("guardada y publicada");
  const unchanged = await page.request.get(`/pages/${SLUG}`);
  const unchangedHtml = await unchanged.text();
  expect(unchangedHtml.match(/Primera revisión pública registrada\./g)).toHaveLength(1);
  expect(unchangedHtml).toContain("Sin cambios en el contenido respecto a la revisión pública anterior.");

  // 5. Page manager: la pagina figura con titulo y links.
  await page.goto("/admin/pages");
  const row = page.locator("tr", { hasText: SLUG });
  await expect(row).toBeVisible();
  await expect(row).toContainText(TITLE_V2);
  await expect(row.locator("a", { hasText: "Editar" })).toHaveAttribute("href", `/admin/editor?slug=${SLUG}`);
  await expect(row.locator("a", { hasText: "Ver" })).toHaveAttribute("href", `/pages/${SLUG}`);

  // Borrar desde el manager (confirm() aceptado) cierra el ciclo inverso.
  page.once("dialog", (dialog) => dialog.accept());
  await row.locator("button", { hasText: "Borrar" }).click();
  await expect(page.locator("tr", { hasText: SLUG })).toHaveCount(0);

  // La URL publica deja de servirla: 404 estatico del build.
  const gone = await page.goto(`/pages/${SLUG}`);
  expect(gone?.status()).toBe(404);

  // 6. La pagina estatica de src/content sigue intacta.
  const staticPage = await page.goto("/pages/ejemplo-atomic-elements");
  expect(staticPage?.status()).toBe(200);
  await expect(page.locator("article.ae-page")).toBeVisible();
});

test("el manager muestra empty state y el form abrir-nueva navega al editor", async ({ page }) => {
  await login(page);
  await page.goto("/admin/pages");
  // Con la pagina del test anterior ya borrada, o hay empty state o la
  // tabla con otras filas -- el form siempre esta.
  await expect(page.locator("#pm-open-form")).toBeVisible();
  await page.fill("#pm-open-slug", "desde-el-manager");
  await page.click("#pm-open-form button[type=submit]");
  await expect(page).toHaveURL(/\/admin\/editor\?slug=desde-el-manager/);
});
