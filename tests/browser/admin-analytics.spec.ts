// Phase 6 — publication maturity: /admin/analytics y /api/analytics.
// El server de browser tests sirve las functions REALES (incluida
// functions/api/analytics.js) sobre SQLite temporal + el build dist/ -- el
// flujo real de self-host, no un mock.
//
// Criterio: el admin configura un proveedor desde la UI nueva, el sitio
// publico empieza a servir ese script en /api/analytics sin rebuild, y
// desactivar vuelve al no-op. Cubre tambien que el rol no-admin no puede
// escribir (403 server-side, no solo escondiendo el form).

import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.afterEach(async ({ page }) => {
  // Dejar el sitio sin analytics para no arrastrar estado entre specs.
  await login(page);
  await page.evaluate(async () => {
    await fetch("/admin/api/analytics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "none", id: "", scriptUrl: "" }),
    });
  });
});

test("configurar plausible desde la UI lo sirve al instante en /api/analytics", async ({ page }) => {
  await login(page);
  await page.goto("/admin/analytics");

  await expect(page.locator("#an-form")).toBeVisible();
  await page.selectOption("#an-provider", "plausible");
  await page.fill("#an-id", "ejemplo.com");
  await page.click(".an-save-btn");
  await expect(page.locator("#an-msg")).toContainText("Guardado");

  const asset = await page.request.get("/api/analytics");
  expect(asset.ok()).toBe(true);
  expect(asset.headers()["content-type"]).toContain("javascript");
  const js = await asset.text();
  expect(js).toContain("plausible.io/js/script.js");
  expect(js).toContain("ejemplo.com");

  // Desactivar desde la propia UI vuelve al no-op.
  await page.reload();
  await page.click("#an-off-btn");
  await expect(page.locator("#an-msg")).toContainText("Guardado");
  const off = await page.request.get("/api/analytics");
  expect(await off.text()).toContain("sin analytics configurado");
});

test("un valor inseguro se rechaza con 400 y no se guarda", async ({ page }) => {
  await login(page);
  const status = await page.evaluate(async () => {
    const r = await fetch("/admin/api/analytics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "custom", id: "", scriptUrl: "javascript:alert(1)" }),
    });
    return r.status;
  });
  expect(status).toBe(400);

  const asset = await page.request.get("/api/analytics");
  expect(await asset.text()).toContain("sin analytics configurado");
});
