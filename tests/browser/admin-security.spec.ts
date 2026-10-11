// Tests de navegador de /admin/security (ROADMAP: "Browser tests
// (Playwright) for /admin/security, ..."). Cubre: gating de sesion (sin
// cookie, el middleware de /admin redirige al login), el formulario de
// cambio de contrasena (error con contrasena actual incorrecta; cambio
// real que cierra todas las sesiones y se registra en el historial
// visible), y el ciclo completo de restauracion para no dejar al server
// de tests con otra contrasena.
import { test, expect } from "@playwright/test";
import { login, BROWSER_TEST_ADMIN_PASSWORD } from "./helpers";

test("sin sesion: el middleware de /admin redirige al login antes de servir la pagina", async ({ page }) => {
  await page.goto("/admin/security");
  // El HTML tambien esta protegido: sin cookie de sesion, 302 a login.
  await page.waitForURL(/\/admin\/login\?error=1/);
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test("logueado: form visible, historial vacio y la contrasena actual incorrecta se rechaza", async ({ page }) => {
  await login(page);
  await page.goto("/admin/security");

  await expect(page.locator("h1.sec-title")).toHaveText("Seguridad de tu cuenta");
  await expect(page.locator("#sec-history-empty")).toBeVisible();

  await page.fill('input[name="currentPassword"]', "Wrong-Pass-123!");
  await page.fill('input[name="newPassword"]', "Otra-Pass-Nueva-1!");
  await page.fill('input[name="repeatPassword"]', "Otra-Pass-Nueva-1!");
  await page.click("#sec-change-btn");

  await expect(page.locator("#sec-change-msg")).toContainText("La contraseña actual no es correcta.");
  await expect(page.locator("#sec-change-msg")).toHaveClass(/sec-error/);
});

test("cambio real cierra sesiones, el historial registra el cambio con la IP real y se restaura todo", async ({ page }) => {
  const TEMP_PASSWORD = "Temp-Browser-Test-Pass9!";

  await login(page);
  await page.goto("/admin/security");

  await page.fill('input[name="currentPassword"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.fill('input[name="newPassword"]', TEMP_PASSWORD);
  await page.fill('input[name="repeatPassword"]', TEMP_PASSWORD);
  await page.click("#sec-change-btn");

  await expect(page.locator("#sec-change-msg")).toContainText("Se cerraron todas tus sesiones");
  // Tras el cambio la pagina sola manda al login (2.5 s de gracia).
  await page.waitForURL(/\/admin\/login$/, { timeout: 15_000 });

  // La sesion vieja quedo invalida: entrar con la contrasena vieja falla.
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/login\?error=1/);

  // Con la nueva si entra, y el historial ya muestra el cambio (1 fila,
  // con la IP del cliente que calculo el runtime Node: 127.0.0.1).
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', TEMP_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/$/);

  await page.goto("/admin/security");
  const rows = page.locator("#sec-history tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Cambio estando logueado");
  await expect(rows.first()).toContainText("127.0.0.1");

  // Restaurar la contrasena original para no dejar el server de tests
  // en un estado que rompa los demas specs.
  await page.fill('input[name="currentPassword"]', TEMP_PASSWORD);
  await page.fill('input[name="newPassword"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.fill('input[name="repeatPassword"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.click("#sec-change-btn");
  await expect(page.locator("#sec-change-msg")).toContainText("Se cerraron todas tus sesiones");
  await page.waitForURL(/\/admin\/login$/, { timeout: 15_000 });

  // Confirmacion final: la original vuelve a funcionar.
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', BROWSER_TEST_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/$/);
});
