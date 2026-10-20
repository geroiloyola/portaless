// Contrato MVP: una fila con marca/home, Publications, Explore, idioma y Share.
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

  // El selector y Share completan el inventario permitido en el header.
  const utilities = page.locator("header.site-header .header-right");
  await expect(utilities).toBeVisible();
  expect(await nav.locator(".header-right").count()).toBe(0);
  const lang = page.locator("header.site-header .header-lang");
  await expect(lang.locator(".header-lang-icon svg")).toBeVisible();
  const share = page.locator("header.site-header [data-portaless-share]");
  await expect(share).toBeVisible();
  await expect(page.locator("[data-portaless-share]")).toHaveCount(1);
  await expect(page.locator("header.site-header .header-trust")).toHaveCount(0);
  await expect(page.locator("footer.site-footer a[href='/trust/']")).toBeVisible();

  const row = page.locator("header.site-header .site-header-row");
  const rowGeometry = await row.evaluate((element) => {
    const nav = element.querySelector(".site-nav")!.getBoundingClientRect();
    const actions = element.querySelector(".header-right")!.getBoundingClientRect();
    return { row: element.getBoundingClientRect(), nav, actions, documentWidth: document.documentElement.scrollWidth };
  });
  expect(Math.round(rowGeometry.nav.top)).toBe(Math.round(rowGeometry.actions.top));
  expect(rowGeometry.nav.right).toBeLessThanOrEqual(rowGeometry.actions.left);
  expect(rowGeometry.documentWidth).toBeLessThanOrEqual(390);

  // El icono de Explorar navega de verdad.
  await page.locator("header.site-header a.nav-link[href='/explore/']").click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test("320px: inventario aprobado del header cabe en un renglón sin targets menores de 44px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(HOME_URL);
  const row = page.locator("header.site-header .site-header-row");
  const controls = page.locator("header.site-header a.brand.nav-home, header.site-header nav.site-nav a.nav-link, header.site-header .header-right a.header-lang, header.site-header .header-right [data-portaless-share]");
  const boxes = await controls.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height };
  }));
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("movil: el shell runtime emite el mismo menu por iconos", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RUNTIME_URL);

  await expect(page.locator("header.site-header nav.site-nav a.brand.nav-home")).toHaveAttribute("href", "/");
  await expect(page.locator("header.site-header nav.site-nav a.nav-link[href='/']")).toHaveCount(0);
  await expect(page.locator("header.site-header a.nav-link[href='/explore/'] .nav-ico svg")).toBeVisible();
  expect(await navTxtHidden(page, "/explore/")).toBe(true);
  await expect(page.locator("header.site-header [data-portaless-share]")).toBeVisible();
  await expect(page.locator("header.site-header .header-trust")).toHaveCount(0);
  await expect(page.locator("footer.site-footer a[href='/trust/']")).toBeVisible();
  expect(await page.locator("header.site-header nav.site-nav .header-right").count()).toBe(0);
});

test("desktop: el menu sigue siendo texto, sin iconos", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HOME_URL);

  const explore = page.locator("header.site-header a.nav-link[href='/explore/']");
  await expect(explore.locator(".nav-txt")).toBeVisible();
  await expect(explore.locator(".nav-ico")).toBeHidden();
});
