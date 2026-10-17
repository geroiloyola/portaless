// Header en MOVIL: el menu pasa a iconos (Inicio, Publicaciones, Explorar,
// idioma) y el compartir se queda DONDE ESTA (ultimo, pegado a la derecha).
// En desktop nada cambia: se ve el texto y los iconos quedan ocultos. Se cubren
// las dos superficies del header: una pagina estatica (home) y el shell runtime
// (/paginas/...), que comparten la misma fuente (NAV_ICONS/navIconHtml).
import { test, expect, type Page } from "@playwright/test";

const HOME_URL = "/";
const RUNTIME_URL = "/paginas/jerry-bantz/";

async function navTxtHidden(page: Page, href: string): Promise<boolean> {
  return page.evaluate((h) => {
    const link = document.querySelector(`header.site-header a.nav-link[href='${h}']`);
    const txt = link?.querySelector(".nav-txt") as HTMLElement | null;
    if (!txt) return false;
    const cs = getComputedStyle(txt);
    return cs.position === "absolute" && (cs.clip !== "auto" || cs.width === "1px");
  }, href);
}

test("movil: menu por iconos, con el compartir intacto a la derecha", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME_URL);

  // Los tres destinos muestran su icono y ocultan el texto (solo visualmente).
  for (const href of ["/", "/blog/", "/explore/"]) {
    const link = page.locator(`header.site-header a.nav-link[href='${href}']`);
    await expect(link).toBeVisible();
    await expect(link.locator(".nav-ico svg")).toBeVisible();
    expect(await navTxtHidden(page, href), `${href} nav-txt oculto en movil`).toBe(true);
  }

  // El idioma es icon-only y el compartir sigue visible, a su derecha.
  const lang = page.locator("header.site-header .header-lang");
  await expect(lang.locator(".header-lang-icon svg")).toBeVisible();
  const share = page.locator("header.site-header [data-portaless-share]");
  await expect(share).toBeVisible();
  await expect(page.locator("[data-portaless-share]")).toHaveCount(1);

  // El TrustScore tambien es icon-only en movil, y va antes del share.
  const trust = page.locator("header.site-header a.header-trust");
  await expect(trust.locator(".header-trust-icon svg")).toBeVisible();
  await expect(trust).toHaveAttribute("href", /\/trust\/$/);

  const langBox = (await lang.boundingBox())!;
  const trustBox = (await trust.boundingBox())!;
  const shareBox = (await share.boundingBox())!;
  expect(langBox.x).toBeLessThan(trustBox.x);
  expect(trustBox.x).toBeLessThan(shareBox.x);

  // El icono de Explorar navega de verdad.
  await page.locator("header.site-header a.nav-link[href='/explore/']").click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test("movil: el shell runtime emite el mismo menu por iconos", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RUNTIME_URL);

  await expect(page.locator("header.site-header a.nav-link[href='/'] .nav-ico svg")).toBeVisible();
  await expect(page.locator("header.site-header a.nav-link[href='/explore/'] .nav-ico svg")).toBeVisible();
  expect(await navTxtHidden(page, "/explore/")).toBe(true);
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
});

test("desktop: el menu sigue siendo texto, sin iconos", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HOME_URL);

  const explore = page.locator("header.site-header a.nav-link[href='/explore/']");
  await expect(explore.locator(".nav-txt")).toBeVisible();
  await expect(explore.locator(".nav-ico")).toBeHidden();
});
