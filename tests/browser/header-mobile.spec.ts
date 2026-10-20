// Contrato del header móvil: una sola fila de navegación; marca = Inicio, y
// acciones contextuales quedan en su propia fila fuera de la barra nav.
import { test, expect, type Page } from "@playwright/test";

const HOME_URL = "/";
const RUNTIME_URL = "/pages/jerry-bantz/";

async function navTxtHidden(page: Page, href: string): Promise<boolean> {
  return page.evaluate((h) => {
    const link = document.querySelector(`header.site-header a.nav-link[href='${h}']`);
    const txt = link?.querySelector(".nav-txt") as HTMLElement | null;
    if (!txt) return false;
    const cs = getComputedStyle(txt);
    return cs.position === "absolute" && (cs.clip !== "auto" || cs.width === "1px");
  }, href);
}

test("movil: una sola fila de nav; marca/inicio unificados y acciones fuera de la barra", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME_URL);

  const nav = page.locator("header.site-header nav.site-nav");
  const brandHome = nav.locator("a.brand.nav-home");
  await expect(brandHome).toHaveAttribute("href", "/");
  await expect(brandHome).toHaveAccessibleName(/Portaless|Inicio/i);
  await expect(nav.locator("a.nav-link[href='/']")).toHaveCount(0);

  // Publicaciones/Explorar mantienen icono visible y texto accesible.
  for (const href of ["/blog/", "/explore/"]) {
    const link = page.locator(`header.site-header a.nav-link[href='${href}']`);
    await expect(link).toBeVisible();
    await expect(link.locator(".nav-ico svg")).toBeVisible();
    expect(await navTxtHidden(page, href), `${href} nav-txt oculto en movil`).toBe(true);
  }

  // Los controles contextuales son visibles, pero no cuentan como entradas nav.
  const utilities = page.locator("header.site-header .header-right");
  await expect(utilities).toBeVisible();
  expect(await nav.locator(".header-right").count()).toBe(0);
  const lang = page.locator("header.site-header .header-lang");
  await expect(lang.locator(".header-lang-icon svg")).toBeVisible();
  const share = page.locator("header.site-header [data-portaless-share]");
  await expect(share).toBeVisible();
  await expect(page.locator("[data-portaless-share]")).toHaveCount(1);

  // El TrustScore tambien es icon-only en movil, y va antes del share.
  const trust = page.locator("header.site-header a.header-trust");
  await expect(trust.locator(".header-trust-icon svg")).toBeVisible();
  await expect(trust).toHaveAttribute("href", /\/trust\/$/);

  const navBoxes = await nav.locator(":scope > a").evaluateAll((links) =>
    links.map((link) => (link as HTMLElement).getBoundingClientRect()),
  );
  expect(new Set(navBoxes.map((box) => Math.round(box.y))).size).toBe(1);
  expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // El icono de Explorar navega de verdad.
  await page.locator("header.site-header a.nav-link[href='/explore/']").click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test("movil: el shell runtime emite el mismo menu por iconos", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RUNTIME_URL);

  await expect(page.locator("header.site-header nav.site-nav a.brand.nav-home")).toHaveAttribute("href", "/");
  await expect(page.locator("header.site-header nav.site-nav a.nav-link[href='/']")).toHaveCount(0);
  await expect(page.locator("header.site-header a.nav-link[href='/explore/'] .nav-ico svg")).toBeVisible();
  expect(await navTxtHidden(page, "/explore/")).toBe(true);
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
  expect(await page.locator("header.site-header nav.site-nav .header-right").count()).toBe(0);
});

test("desktop: el menu sigue siendo texto, sin iconos", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HOME_URL);

  const explore = page.locator("header.site-header a.nav-link[href='/explore/']");
  await expect(explore.locator(".nav-txt")).toBeVisible();
  await expect(explore.locator(".nav-ico")).toBeHidden();
});
