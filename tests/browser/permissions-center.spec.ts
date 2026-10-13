// El Centro de Permisos tenia DOS rutas y solo una era visible: la
// Function functions/admin/permissions/index.js respondia JSON a todo GET
// y tapaba src/pages/admin/permissions.astro (las funciones corren antes
// que los estaticos en self-host y en Cloudflare Pages), asi que un
// humano que abria /admin/permissions desde el dashboard veia el JSON
// crudo del snapshot. Con la negociacion Accept: text/html + env.ASSETS la
// pagina se sirve como HTML y el fetch() de la propia UI sigue recibiendo
// el JSON. Este spec lo comprueba en el navegador real, no en un mock.
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("/admin/permissions sirve la UI, no el JSON crudo", async ({ page }) => {
  await login(page);
  await page.goto("/admin/permissions");

  await expect(page.locator("h1.pc-page-title")).toHaveText("Centro de Permisos");
  // El render es client-side a partir de GET /admin/permissions (Accept */*).
  await expect(page.locator(".pc-capability").first()).toBeVisible();
  await expect(page.locator(".pc-subject-label").first()).toBeVisible();

  // Y el icono del subject es un SVG inline, no un emoji (los emojis los
  // pinta el SO con su propio color y rompen el contraste).
  const icon = page.locator(".pc-subject-icon svg").first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("stroke", "currentColor");
});

test("el endpoint sigue devolviendo JSON a los clientes de API", async ({ page }) => {
  await login(page);
  const res = await page.evaluate(async () => {
    const r = await fetch("/admin/permissions");
    return { status: r.status, type: r.headers.get("content-type"), body: await r.json() };
  });
  expect(res.status).toBe(200);
  expect(res.type).toContain("application/json");
  expect(Array.isArray(res.body.grants)).toBe(true);
});
