// El boton "Compartir" de la bio es client-side (listener delegado en
// BaseLayout): los tests unitarios solo prueban el HTML emitido, aqui se
// verifica que al hacer clic realmente copie la URL y avise. De paso,
// los contratos visibles del nuevo ecosistema: header sin "Blog" y el
// footer TrustScore · Explore · Powered by Portaless.
import { test, expect } from "@playwright/test";

const BIO_URL = "/paginas/jerry-bantz/";

test("el boton compartir copia la URL al portapapeles y avisa", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(BIO_URL);

  // Un solo share en toda la pagina: el del rincon del header (el
  // ProfileHeader ya no trae el suyo -- fin del doble share).
  const share = page.locator("header.site-header [data-portaless-share]");
  await expect(share).toBeVisible();
  await expect(share).toHaveAttribute("aria-label", "Compartir este enlace");
  await expect(page.locator("[data-portaless-share]")).toHaveCount(1);

  await share.click();

  await expect(page.getByRole("status")).toHaveText("Enlace copiado");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("/paginas/jerry-bantz/");
});

test("header dice Publicaciones (nunca Blog) y trae el indice si hay posts", async ({ page }) => {
  await page.goto(BIO_URL);

  const postsLink = page.getByRole("navigation").getByRole("link", { name: "Publicaciones" });
  await expect(postsLink).toHaveAttribute("href", /\/blog\/$/);
  await expect(page.getByRole("navigation").getByText("Blog", { exact: true })).toHaveCount(0);

  // Atomic Icons Responsive: una bio sin video ni productos lleva SOLO
  // el compartir en el rincon del header.
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
  await expect(page.locator("header.site-header [data-portaless-volume]")).toHaveCount(0);
  await expect(page.locator("header.site-header a.header-icon-btn[href='/tienda/']")).toHaveCount(0);
});

test("Atomic Icons Responsive: pagina de video lleva control de volumen", async ({ page }) => {
  await page.goto("/paginas/lanzamiento/");

  await expect(page.locator("header.site-header [data-portaless-volume]")).toBeVisible();
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
});

test("Atomic Icons Responsive: pagina de shop lleva el carrito al rincon", async ({ page }) => {
  await page.goto("/paginas/link-in-bio/");

  const cart = page.locator("header.site-header a.header-icon-btn[href='/tienda/']");
  await expect(cart).toBeVisible();
  await expect(cart).toHaveAttribute("aria-label", "Ir a la tienda");
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
});

test("footer del ecosistema: TrustScore · Explore · Powered by Portaless", async ({ page }) => {
  await page.goto(BIO_URL);

  const footer = page.locator("footer.site-footer");
  await expect(footer.getByRole("link", { name: "TrustScore" })).toHaveAttribute("href", /\/trust\/default$/);
  await expect(footer.getByRole("link", { name: "Explore" })).toHaveAttribute("href", /\/explore\/$/);
  await expect(footer.getByRole("link", { name: "Powered by Portaless" })).toHaveAttribute("href", /github\.com/);
  await expect(footer).toContainText("Open Source, Modular, Agent-Ready & Zero-Hosting");
});

test("Explore existe y lista paginas publicadas (sin links rotos)", async ({ page }) => {
  await page.goto("/explore/");

  await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Jerry Bantz/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "TrustScore de este sitio" })).toBeVisible();
});
