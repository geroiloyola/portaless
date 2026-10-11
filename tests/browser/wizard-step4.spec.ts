// Tests de navegador del Paso 4 del wizard (/admin/wizard/step-4-backup-key,
// ROADMAP: "Browser tests (Playwright) for ... wizard step 4"). Cubre:
// gating de sesion (sin login el POST de identidad responde 401 y la
// pagina manda al login) y el camino "identidad ya generada" (el server
// de tests la siembra): did visible, aviso de que la clave privada solo se
// mostro una vez, checkbox pre-marcado y deshabilitado, hint de rotacion,
// y el Continuar que lleva al paso 5.
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("sin sesion: el POST de identidad recibe 401 y la pagina manda al login", async ({ page }) => {
  await page.goto("/admin/wizard/step-4-backup-key");
  await page.waitForURL(/\/admin\/login\?error=1/);
});

test("con identidad sembrada: did visible, clave no recuperable y Continuar hacia el paso 5", async ({ page }) => {
  await login(page);
  await page.goto("/admin/wizard/step-4-backup-key");

  await expect(page.locator("#wiz-loading")).toBeHidden();
  await expect(page.locator("#wiz-root")).toBeVisible();
  await expect(page.locator("#wiz-did-value")).toHaveText(/^did:apw:/);

  // Identidad ya existente (409 del API): la clave privada no se vuelve a
  // mostrar, el copiar desaparece y el checkbox queda marcado y bloqueado.
  await expect(page.locator("#wiz-key-value")).toContainText("solo se mostro la primera vez");
  await expect(page.locator("#wiz-key-copy")).toBeHidden();
  await expect(page.locator("#wiz-confirm-saved")).toBeChecked();
  await expect(page.locator("#wiz-confirm-saved")).toBeDisabled();
  await expect(page.locator("#wiz-rotate-hint")).toBeVisible();
  await expect(page.locator("#wiz-continue")).toBeEnabled();

  await page.click("#wiz-continue");
  await expect(page).toHaveURL(/\/admin\/wizard\/step-5-admin-credentials$/);
});
