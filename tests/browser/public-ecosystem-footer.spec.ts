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

test("el selector de idioma es un control accionable, alineado a la derecha (en el home)", async ({ page }) => {
  // El switcher vive donde hay una version REAL en el otro locale: el home.
  await page.goto("/");

  // Vive en el grupo derecho del header, no entre las etiquetas del menu.
  const lang = page.locator("header.site-header .header-right a.header-lang");
  await expect(lang).toBeVisible();
  await expect(lang).toHaveAttribute("hreflang", "es");
  await expect(lang).toHaveAttribute("href", /\/es\/$/);

  // Trae el icono de idiomas: se lee como accion, no como una palabra suelta.
  await expect(lang.locator(".header-lang-icon svg")).toHaveCount(1);
  await expect(lang.locator(".header-lang-text")).toHaveText("Español");

  // El grupo derecho arranca a la derecha del ultimo enlace del menu.
  const exploreBox = await page.locator("header.site-header a[href='/explore/']").boundingBox();
  const langBox = await lang.boundingBox();
  expect(langBox!.x).toBeGreaterThan(exploreBox!.x + exploreBox!.width);
});

test("en una pagina no localizada: sin switcher, con el aviso de idioma honesto (sin link a otro sitio)", async ({ page }) => {
  // La bio no tiene version en otro idioma: en vez de un icono que lleva al
  // home a ciegas, va el aviso (patron Airbnb). No enlaza a otro sitio: la
  // traduccion real de una pagina es su version en el otro locale.
  await page.goto(BIO_URL);

  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveCount(0);
  const notice = page.locator("header.site-header .header-lang-notice");
  await expect(notice).toBeVisible();
  await expect(notice.locator(".header-lang-notice-txt")).toHaveText(
    "Esta página solo está disponible en un idioma."
  );
  // Sin CTA: no hay una version de ESTA pagina en otro idioma que ofrecer.
  await expect(notice.locator(".header-lang-notice-link")).toHaveCount(0);
  // No promete traduccion automatica.
  await expect(notice).not.toContainText("Traducir");
  await expect(notice).not.toContainText("Translate");
});

test("una pagina con traduccion: el switcher lleva a la MISMA pagina en el otro idioma", async ({ page }) => {
  // /paginas/ejemplo-atomic-elements/ es espanol y tiene version en ingles:
  // el switcher va a esa version (misma pagina), nunca al home.
  await page.goto("/paginas/ejemplo-atomic-elements/");

  const pill = page.locator("header.site-header .header-right a.header-lang");
  await expect(pill).toHaveAttribute("href", /\/en\/paginas\/ejemplo-atomic-elements\/$/);
  await expect(pill).toHaveAttribute("hreflang", "en");
  // Sin aviso: hay traduccion real.
  await expect(page.locator("header.site-header .header-lang-notice")).toHaveCount(0);

  // Y la version en ingles vuelve a la espanola.
  await page.goto("/en/paginas/ejemplo-atomic-elements/");
  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveAttribute(
    "href",
    /\/paginas\/ejemplo-atomic-elements\/$/
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("beta es bilingue: el switcher lleva a la MISMA pagina en el otro idioma", async ({ page }) => {
  await page.goto("/beta/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("h1")).toContainText("Sitios verificables");
  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveAttribute(
    "href",
    /\/en\/beta\/$/
  );

  await page.goto("/en/beta/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toContainText("Verifiable sites");
  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveAttribute(
    "href",
    /\/beta\/$/
  );
});

test("proyecciones es bilingue: el switcher lleva a la MISMA pagina en el otro idioma", async ({ page }) => {
  await page.goto("/proyecciones/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("h1")).toContainText("Un canon, cinco proyecciones");
  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveAttribute(
    "href",
    /\/en\/proyecciones\/$/
  );

  await page.goto("/en/proyecciones/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toContainText("One canon, five projections");
  await expect(page.locator("header.site-header .header-right a.header-lang")).toHaveAttribute(
    "href",
    /\/proyecciones\/$/
  );
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

test("Atomic Icons Responsive: pagina con mapa lleva icono de como llegar", async ({ page }) => {
  await page.goto("/paginas/ejemplo-atomic-elements/");

  const dir = page.locator("header.site-header a.header-icon-btn[href='#ae-map']");
  await expect(dir).toBeVisible();
  await expect(dir).toHaveAttribute("aria-label", "Cómo llegar");
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
});

test("footer del ecosistema: TrustScore · Explore · Powered by Portaless", async ({ page }) => {
  await page.goto(BIO_URL);

  const footer = page.locator("footer.site-footer");
  await expect(footer.getByRole("link", { name: "TrustScore" })).toHaveAttribute("href", /\/trust\/$/);
  await expect(footer.getByRole("link", { name: "Explore" })).toHaveAttribute("href", /\/explore\/$/);
  await expect(footer.getByRole("link", { name: "Powered by Portaless" })).toHaveAttribute("href", /github\.com/);
  await expect(footer).toContainText("Open Source, Modular, Agent-Ready & Zero-Hosting");
});

test("el TrustScore vive en el header, al lado de Share, apuntando al hub /trust/", async ({ page }) => {
  await page.goto(BIO_URL);

  const trust = page.locator("header.site-header a.header-trust");
  await expect(trust).toBeVisible();
  await expect(trust).toHaveAttribute("href", /\/trust\/$/);
  await expect(trust).toHaveAttribute("aria-label", "TrustScore del sitio");
  await expect(trust.locator(".header-trust-icon svg")).toHaveCount(1);

  // Va ANTES del share (que sigue pegado al borde derecho).
  const trustBox = (await trust.boundingBox())!;
  const shareBox = (await page.locator("header.site-header [data-portaless-share]").boundingBox())!;
  expect(trustBox.x).toBeLessThan(shareBox.x);
});

test("Explore existe y lista paginas publicadas (sin links rotos)", async ({ page }) => {
  await page.goto("/explore/");

  await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Jerry Bantz/ })).toBeVisible();
  // Explore esta localizado (/explore/ en, /es/explore/ es): el label del
  // TrustScore cambia con el locale, asi que el test no fija uno solo.
  await expect(
    page.getByRole("link", { name: /TrustScore (de este sitio|of this site)/ })
  ).toBeVisible();
});

// Fase 12 (§2): la superficie publica /trust/default no muestra valores
// fabricados. El resumen son conteos reales del snapshot o "Sin datos".
test("/trust/default renderiza el resumen real y no contiene '92'", async ({ page }) => {
  await page.goto("/trust/default");

  await expect(page.getByRole("heading", { level: 1, name: "Site Trust Score" })).toBeVisible();
  await expect(page.locator(".st-source-section").first()).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("92");
  expect(body).not.toContain("32K+");
  expect(body).not.toContain("Sin disputas");
  expect(body).not.toContain("canónica");
});
