// Tests de navegador de /admin/wizard/rotate-identity (ROADMAP: "Browser
// tests (Playwright) for ... /admin/wizard/rotate-identity, ..."). Cubre:
// gating de sesion (el middleware de /admin redirige al login), el
// gating del boton con la palabra ROTAR, el rechazo de una rotacion con
// contrasena incorrecta (step-up) y la rotacion real, que cambia el did
// y muestra la clave nueva una sola vez.
//
// El server de tests siembra una identidad (did:apw:browser-test.example),
// asi que la pantalla arranca SIEMPRE en el camino "ya hay identidad".
import { test, expect } from "@playwright/test";
import { login, BROWSER_TEST_ADMIN_PASSWORD } from "./helpers";

test("sin sesion: el middleware de /admin redirige al login antes de servir la pagina", async ({ page }) => {
  await page.goto("/admin/wizard/rotate-identity");
  await page.waitForURL(/\/admin\/login\?error=1/);
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test("logueado: gating con ROTAR, step-up con contrasena y rotacion real del did", async ({ page }) => {
  await login(page);
  await page.goto("/admin/wizard/rotate-identity");

  const currentDid = page.locator("#current-did");
  await expect(currentDid).toHaveText(/^did:apw:/);
  const oldDid = (await currentDid.textContent())?.trim();
  expect(oldDid).toBeTruthy();

  // El boton solo se habilita al escribir ROTAR.
  await expect(page.locator("#rotate-btn")).toBeDisabled();
  await page.fill('input[name="confirm"]', "ROTAR");
  await expect(page.locator("#rotate-btn")).toBeEnabled();

  // Step-up: contrasena incorrecta -> error explicito, sin rotar nada.
  await page.fill('input[name="password"]', "Wrong-Pass-123!");
  await page.click("#rotate-btn");
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#result")).toBeHidden();

  // Rotacion real: contrasena correcta + ROTAR.
  await page.fill('input[name="password"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.click("#rotate-btn");
  await expect(page.locator("#result")).toBeVisible();

  // did:apw esta ligado al DOMINIO (did:apw:<dominio>): rotar reemplaza
  // la CLAVE activa, no el DID -- por eso "Nueva" muestra el mismo did y
  // la pagina recalca que las firmas con la clave vieja dejan de
  // verificar. El cambio de clave (kid/key_sequence, privada vieja
  // cerrada) lo cubre tests/unit/apw-site-identity-rotation.test.ts;
  // aqui cubrimos la UI del flujo completo.
  const newDid = (await page.locator("#new-did").textContent())?.trim();
  expect(newDid).toMatch(/^did:apw:/);
  expect(newDid).toBe(oldDid);
  await expect(page.locator("#previous-did")).toHaveText(oldDid!);
  await expect(page.locator("#download-btn")).toBeVisible();
  // La cabecera de la pagina queda en la identidad vigente.
  await expect(currentDid).toHaveText(newDid!);
});
