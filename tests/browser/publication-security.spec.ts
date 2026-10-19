// C06: marker privado/draft sinteticos del disposable staging no salen por
// runtime publico ni por llms.txt; el admin sí ve el estado privado en su UI.
import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import { BROWSER_TEST_VIEWER_PASSWORD, BROWSER_TEST_VIEWER_USER } from "../../scripts/browser-test-server.mjs";

test("draft/private no son publicos, llms filtra y admin ve estado private", async ({ page }) => {
  await login(page);

  await page.goto("/admin/pages/");
  const privateRow = page.locator("tr", { hasText: "staging-private" });
  await expect(privateRow).toContainText("Privada");
  await expect(privateRow.locator("a", { hasText: "Ver" })).toHaveCount(0);
  await expect(privateRow.locator("a", { hasText: "Vista previa" })).toHaveAttribute("href", "/admin/preview/pages/staging-private");

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

test("preview autenticado muestra drafts con noindex y sin canonical publico", async ({ page }) => {
  await login(page);
  const draft = await page.goto("/admin/preview/pages/staging-draft/");
  expect(draft?.status()).toBe(200);
  expect(draft?.headers()["cache-control"]).toContain("no-store");
  expect(draft?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator("body")).toContainText("PORTALESS_PRIVATE_DRAFT_MARKER_2A810D");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

  const publicPreview = await page.goto("/admin/preview/pages/staging-public/");
  expect(publicPreview?.status()).toBe(404); // este endpoint es solo para no-publicadas
});

test("preview privado exige sesion admin", async ({ page }) => {
  const anonymous = await page.goto("/admin/preview/pages/staging-draft/");
  expect(anonymous?.status()).toBe(200); // redireccion HTTP a la pagina de login
  expect(page.url()).toContain("/admin/login?error=1");
  await expect(page.locator("body")).not.toContainText("PORTALESS_PRIVATE_DRAFT_MARKER_2A810D");

  await login(page, BROWSER_TEST_VIEWER_USER, BROWSER_TEST_VIEWER_PASSWORD);
  const viewerResponse = await page.goto("/admin/preview/pages/staging-draft/");
  expect(viewerResponse?.status()).toBe(403);
  await expect(page.locator("body")).not.toContainText("PORTALESS_PRIVATE_DRAFT_MARKER_2A810D");
});
