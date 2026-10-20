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

  test("controles del header y el footer cumplen 44x44 (WCAG 2.5.5)", async ({ page }) => {
    await page.goto("/pages/ejemplo-atomic-elements/");
    const controls = [
      "header.site-header a.nav-link[href='/explore/']",
      "header.site-header .header-icon-btn",
      "header.site-header .header-lang",
    ];
    for (const sel of controls) {
      const box = await page.locator(sel).first().boundingBox();
      if (!box) continue; // el control puede no existir en esta pagina
      expect(Math.round(box.width), `${sel} ancho`).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.height), `${sel} alto`).toBeGreaterThanOrEqual(44);
    }
    for (const link of await page.locator("footer.site-footer .footer-eco a").all()) {
      const box = await link.boundingBox();
      if (box) expect(Math.round(box.height), "footer link").toBeGreaterThanOrEqual(44);
    }
  });
});

// iPhone SE (320px): el peor caso del FeatureGrid (minmax 280px fijo desbordaba).
test.describe("movil chico 320x568 (iPhone SE)", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const path of ["/", "/pages/servicios/", "/pages/portafolio/"]) {
    test(`${path} no desborda a 320px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await horizontalOverflow(page);
      expect(overflow, `${path} desborda ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("Docs en 320x480", () => {
  test.use({ viewport: { width: 320, height: 480 } });

  for (const scale of [1, 2]) {
    test(`/docs/first-steps/ reflow y teclado con texto al ${scale * 100}%`, async ({ page }) => {
      await page.goto("/docs/first-steps/");
      // Text enlargement tests reflow independently of device pixel density;
      // this is not presented as an OS/browser pinch-zoom certification.
      await page.evaluate((factor) => { document.documentElement.style.fontSize = `${factor * 100}%`; }, scale);
      await expect(page.locator(".docs-content h1")).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      await page.locator("#docs-nav-toggle").focus();
      await page.keyboard.press("Space");
      await expect(page.locator(".docs-nav")).toBeVisible();
      for (const control of await page.locator(".docs-nav-link, .docs-nav-summary, .docs-md").all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test("conserva el articulo, limita el overflow al documento y permite abrir el sidebar con teclado", async ({ page }) => {
    await page.goto("/docs/protocol-apw/");
    await expect(page.locator(".docs-content h1")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const article = document.querySelector(".docs-content") as HTMLElement;
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        articleLeft: article.getBoundingClientRect().left,
        articleRight: article.getBoundingClientRect().right,
        viewportWidth: document.documentElement.clientWidth,
        narrowBlocks: Array.from(document.querySelectorAll(".docs-content pre, .docs-content table")).map((node) => {
          const block = node as HTMLElement;
          const rect = block.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            clientWidth: block.clientWidth,
            scrollWidth: block.scrollWidth,
            overflowX: getComputedStyle(block).overflowX,
          };
        }),
      };
    });
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.articleLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.articleRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    for (const block of geometry.narrowBlocks) {
      expect(block.left).toBeGreaterThanOrEqual(0);
      expect(block.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      if (block.scrollWidth > block.clientWidth) expect(block.overflowX).toBe("auto");
    }

    const summary = page.locator(".docs-nav-summary");
    const summaryBox = await summary.boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(Math.round(summaryBox!.height)).toBeGreaterThanOrEqual(44);
    await page.locator("#docs-nav-toggle").focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".docs-nav")).toBeVisible();
    await expect(summary).toHaveCSS("outline-style", "solid");
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
