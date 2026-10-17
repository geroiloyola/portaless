// Phase 0 — visual identity foundation. Criterio de salida: cambiar el
// accent en UN lugar (/admin/appearance -> site_skin) y verlo reflejado
// en el sitio publico, el dashboard y el editor, sin tocar CSS a mano.
// Before/after real con computed styles (no mock): se guarda un accent
// y un bg nuevos v UI, se recarga y se verifica la cascada completa
// (var en :root + consumidores reales + la hoja /api/site-skin).
//
// workers: 1 y orden serial a proposito (Playwright config): el server
// y la base son compartidos; el ultimo test restaura los defaults.

import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

const OFFICIAL_ACCENT = "#c5d86d";
const TEST_ACCENT = "#ff00aa";
const TEST_BG = "#fef3c7"; // amber-100, distinguishable del hueso oficial

// Pagina testigo del SKIN del sitio: publica, con BaseLayout (trae
// /api/site-skin) y SIN tema por pagina. El home, blog, docs y explore llevan
// el pack del ecosistema (data-theme-pack + estilos inline en <html>), que por
// diseno vence al skin; por eso el contrato del skin se mide en una pagina sin
// pack, no en el home (que es del pack, no del skin).
const SKIN_WITNESS_URL = "/trust/";

async function varOf(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim().toLowerCase(),
    name
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

test.afterAll(async ({ browser }) => {
  // Restaurar el skin base sin overrides para no dejar al server de
  // tests con accent rosa en los demas specs.
  const page = await browser.newPage();
  await login(page);
  await page.evaluate(async () => {
    await fetch("/admin/api/skin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skin: "base", tokens: {} }),
    });
    localStorage.removeItem("portaless-theme");
  });
  await page.close();
});

test("sitio publico: el accent por defecto es el oficial (#C5D86D)", async ({ page }) => {
  await page.goto(SKIN_WITNESS_URL);
  await page.waitForLoadState("networkidle");
  expect(await varOf(page, "--accent")).toBe(OFFICIAL_ACCENT);
  expect(await varOf(page, "--bg")).toBe("#f7f7f2");
  // Los alias historicos siguen atados a los tokens.
  expect(await varOf(page, "--portaless-accent")).toBe(OFFICIAL_ACCENT);
});

test("el home lleva el pack del ecosistema, no el skin (por diseno)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("data-theme-pack", "portaless-nocturno");
  // El pack se aplica inline en <html>, asi que gana sobre el skin.
  expect(await varOf(page, "--bg")).toBe("#0e0b08");
});

test("cambiar accent y fondo desde /admin/appearance se refleja en publico, dashboard y editor", async ({ page }) => {
  await login(page);
  await page.goto("/admin/appearance");
  await expect(page.locator("#ap-root")).toBeVisible();
  await expect(page.locator("#ap-skin")).toHaveValue("base");

  // Before: el sitio publico tiene el oficial.
  await page.goto(SKIN_WITNESS_URL);
  await page.waitForLoadState("networkidle");
  const accentBefore = await varOf(page, "--accent");
  expect(accentBefore).toBe(OFFICIAL_ACCENT);

  // Cambiar accent + fondo via el formulario real y guardar.
  await page.goto("/admin/appearance");
  await expect(page.locator("#ap-root")).toBeVisible();
  await page.locator("#ap-accent").evaluate((el, value) => {
    (el as HTMLInputElement).value = value;
  }, TEST_ACCENT);
  await page.locator("#ap-bg").evaluate((el, value) => {
    (el as HTMLInputElement).value = value;
  }, TEST_BG);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(".ap-save-btn"),
  ]);
  // Tras el reload el form pinta lo guardado.
  await expect(page.locator("#ap-accent")).toHaveValue(TEST_ACCENT);

  // After (sitio publico): vars nuevas + consumidor real (body bg).
  await page.goto(SKIN_WITNESS_URL);
  await page.waitForLoadState("networkidle");
  expect(await varOf(page, "--accent")).toBe(TEST_ACCENT);
  expect(await varOf(page, "--portaless-accent")).toBe(TEST_ACCENT);
  expect(await varOf(page, "--bg")).toBe(TEST_BG);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe(hexToRgb(TEST_BG));

  // La hoja publica trae los valores (un solo punto de verdad).
  const css = await page.evaluate(async () => (await fetch("/api/site-skin")).text());
  expect(css).toContain(`--accent: ${TEST_ACCENT};`);
  expect(css).toContain(`--bg: ${TEST_BG};`);

  // Dashboard (/admin/) comparte la misma cascada.
  await page.goto("/admin/");
  await expect(page.locator("h1, .ai-page-title").first()).toBeVisible();
  expect(await varOf(page, "--accent")).toBe(TEST_ACCENT);

  // Editor visual tambien.
  await page.goto("/admin/editor");
  await page.waitForLoadState("domcontentloaded");
  expect(await varOf(page, "--accent")).toBe(TEST_ACCENT);
});

test("toggle oscuro: data-theme=dark aplica la paleta oficial oscura y auto la restaura", async ({ page }) => {
  await login(page);
  await page.goto("/admin/appearance");
  await expect(page.locator("#ap-root")).toBeVisible();

  await page.selectOption("#ap-theme", "dark");
  await page.goto(SKIN_WITNESS_URL);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(await varOf(page, "--bg")).toBe("#261c15");
  expect(await varOf(page, "--text")).toBe("#f7f7f2");
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe(hexToRgb("#261C15"));

  // Volver a auto: sin data-theme, manda la preferencia del SO (light
  // en el runner) -> paleta clara otra vez.
  await login(page);
  await page.goto("/admin/appearance");
  await expect(page.locator("#ap-root")).toBeVisible();
  await page.selectOption("#ap-theme", "auto");
  await page.goto(SKIN_WITNESS_URL);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(false);
});
