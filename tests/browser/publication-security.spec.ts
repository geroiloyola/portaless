// C06: marker privado/draft sinteticos del disposable staging no salen por
// runtime publico ni por llms.txt; el admin sí ve el estado privado en su UI.
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("draft/private no son publicos, llms filtra y admin ve estado private", async ({ page }) => {
  await login(page);

  await page.goto("/admin/pages/");
  const privateRow = page.locator("tr", { hasText: "staging-private" });
  await expect(privateRow).toContainText("Privada");
  await expect(privateRow.locator("a", { hasText: "Ver" })).toHaveCount(0);

  const privatePage = await page.goto("/pages/staging-private/");
  expect(privatePage?.status()).toBe(404);
  await expect(page.locator("body")).not.toContainText("PORTALESS_PRIVATE_ARCHIVE_MARKER_5B0F31");

  const draftPage = await page.goto("/pages/staging-draft/");
  expect(draftPage?.status()).toBe(404);
  await expect(page.locator("body")).not.toContainText("PORTALESS_PRIVATE_DRAFT_MARKER_2A810D");

  const llmsResponse = await page.goto("/llms.txt");
  expect(llmsResponse?.status()).toBe(200);
  const llms = await page.locator("body").innerText();
  expect(llms).not.toContain("staging-private");
  expect(llms).not.toContain("PORTALESS_PRIVATE_ARCHIVE_MARKER_5B0F31");
  expect(llms).not.toContain("staging-draft");
  expect(llms).not.toContain("PORTALESS_PRIVATE_DRAFT_MARKER_2A810D");
});
