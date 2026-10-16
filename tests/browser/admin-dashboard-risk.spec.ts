// §13.5: el dashboard ya no muestra solo un enlace al Centro de Permisos;
// muestra el resumen de riesgo. El total por nivel sale del build (catalogo);
// las concedidas se cuentan en el navegador contra /admin/permissions.
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("el dashboard muestra el resumen de riesgo de permisos", async ({ page }) => {
  await login(page);
  await page.goto("/admin/");

  const summary = page.locator("#ai-risk-summary");
  await expect(summary).toBeVisible();
  await expect(summary.locator(".ai-risk-cell")).toHaveCount(3);
  await expect(summary.locator('.ai-risk-cell[data-risk="alto"]')).toBeVisible();
  await expect(summary.locator('.ai-risk-cell[data-risk="medio"]')).toBeVisible();
  await expect(summary.locator('.ai-risk-cell[data-risk="bajo"]')).toBeVisible();

  await expect(summary.getByRole("link", { name: "Abrir el Centro de Permisos" })).toHaveAttribute(
    "href",
    "/admin/permissions"
  );

  // La descripcion arranca en "Contando…" y termina diciendo el estado real.
  await expect(page.locator("#ai-risk-desc")).toContainText(/concedid/, { timeout: 10_000 });
});
