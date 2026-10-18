// §13.4 -- la demo publica "un canon, cinco proyecciones". El test unitario
// (tests/unit/projections-demo.test.ts) prueba la logica pura; aqui se verifica
// que la pagina REAL sale con las cinco tarjetas y con la honestidad correcta:
// las tres derivables en build dicen "coincide" y las dos que necesitan nodo
// dicen "requiere nodo", nunca verde.
import { test, expect } from "@playwright/test";

const DEMO_URL = "/es/projections/";

test("la demo muestra el canon y sus cinco proyecciones", async ({ page }) => {
  await page.goto(DEMO_URL);

  await expect(page.getByRole("heading", { level: 1, name: "Un canon, cinco proyecciones" })).toBeVisible();

  // El canon es la fuente de verdad, no una tarjeta mas.
  const canon = page.locator("section.canon");
  await expect(canon).toContainText("El canon (fuente de verdad)");
  await expect(canon).toContainText("src/content/posts/bienvenida.md");

  for (const name of ["Página", "Feed", "Manifiesto", "Índice", "Otra plataforma"]) {
    await expect(page.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
  }

  // 3 verificables + 2 que requieren nodo.
  await expect(page.locator('.proj-state[data-match="true"]')).toHaveCount(3);
  await expect(page.locator('.proj-state[data-match="null"]')).toHaveCount(2);
  await expect(page.locator('.proj-state[data-match="false"]')).toHaveCount(0);

  // Las dos que necesitan nodo estan marcadas como tales, no en verde.
  for (const name of ["Manifiesto", "Otra plataforma"]) {
    const card = page.locator("article.proj", { has: page.getByRole("heading", { level: 3, name, exact: true }) });
    await expect(card).toContainText("requiere nodo");
    await expect(card).toHaveClass(/proj-node/);
  }
});
