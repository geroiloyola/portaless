// Movil: la clase de bug que los tests de rutas no ven. Los grids del core
// (ProductGrid/StoreBlock/Columns/Gallery) emitian `repeat(N,1fr)` INLINE, que
// no admite media queries: en 375px dejaba N columnas de ~100px y scroll
// horizontal. Ahora el layout vive en elements.css (intrinseco). Este spec lo
// verifica en un viewport real de telefono, sobre las plantillas reales.
import { test, expect, type Page } from "@playwright/test";

const MOBILE = { width: 375, height: 812 };

// Las 17 plantillas: home, blog, docs, explore, y las 9 paginas demo + las
// paginas del sistema.
const TEMPLATES = [
  "/",
  "/blog/",
  "/docs/",
  "/explore/",
  "/pages/boutique/",
  "/pages/club-evento/",
  "/pages/ejemplo-atomic-elements/",
  "/pages/jerry-bantz/",
  "/pages/lanzamiento/",
  "/pages/link-in-bio/",
  "/pages/musica-merch/",
  "/pages/portafolio/",
  "/pages/servicios/",
  "/projections/",
];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test.describe("movil 375x812", () => {
  test.use({ viewport: MOBILE });

  for (const path of TEMPLATES) {
    test(`${path} no desborda horizontalmente`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await horizontalOverflow(page);
      expect(overflow, `${path} desborda ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test("las tarjetas de las grillas no quedan del ancho minimo roto (<140px)", async ({ page }) => {
    // Un `repeat(N,1fr)` inline en 375px dejaba cards de ~100px; la grilla
    // intrinseca garantiza >= --ae-min (9rem = 144px) por pista.
    for (const path of ["/pages/boutique/", "/pages/portafolio/", "/pages/ejemplo-atomic-elements/"]) {
      await page.goto(path);
      const widths = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".ae-columns > *, .ae-product-grid > *, .ae-gallery > *"))
          .map((el) => (el as HTMLElement).getBoundingClientRect().width)
          .filter((w) => w > 0)
      );
      for (const w of widths) expect(w, `${path}: card de ${Math.round(w)}px`).toBeGreaterThanOrEqual(140);
    }
  });

  test("el header sigue siendo icon-only en movil (texto oculto)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header.site-header a.nav-link[href='/explore/'] .nav-ico svg")).toBeVisible();
    const hidden = await page.evaluate(() => {
      const txt = document.querySelector("header.site-header a.nav-link[href='/explore/'] .nav-txt") as HTMLElement | null;
      return txt ? getComputedStyle(txt).clip : "auto";
    });
    expect(hidden).not.toBe("auto");
  });

  test("el sidebar de docs arranca colapsado en movil (no empuja el articulo)", async ({ page }) => {
    await page.goto("/docs/protocol-apw/");
    await expect(page.locator(".docs-nav-summary")).toBeVisible();
    await expect(page.locator(".docs-nav")).toBeHidden();
    // El label lo abre (sin JS).
    await page.locator(".docs-nav-summary").click();
    await expect(page.locator(".docs-nav")).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("el sidebar de docs muestra el nav y esconde el summary", async ({ page }) => {
    await page.goto("/docs/protocol-apw/");
    await expect(page.locator(".docs-nav-wrap .docs-nav")).toBeVisible();
    await expect(page.locator(".docs-nav-summary")).toBeHidden();
  });
});
