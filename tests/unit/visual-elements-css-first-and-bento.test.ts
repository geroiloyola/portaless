// PR 3 de 3: Visual Elements CSS-first + Columns.ratio + FeatureGrid Bento Grid.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  elementRegistry,
  COLUMNS_RATIOS,
  FEATURE_GRID_LAYOUTS,
} from "../../packages/visual-elements/src/elements/registry";
import { validatePageLayout } from "../../packages/visual-elements/src/persistence/page-schema";
import { renderPage } from "../../packages/visual-elements/src/render";

const root = join(__dirname, "../..");
const elementsCss = readFileSync(join(root, "packages/visual-elements/src/styles/elements.css"), "utf8");
const globalCss = readFileSync(join(root, "src/styles/global.css"), "utf8");

describe("Visual Elements CSS-first (sin estilos inline rigidos)", () => {
  it("Button renderiza clases .ae-btn sin style inline", () => {
    const html = elementRegistry.Button.renderHTML({
      label: "Empezar",
      href: "/pages/guias/",
      variant: "solid",
      size: "lg",
    } as never);
    expect(html).toBe('<a class="ae-btn ae-btn--solid ae-btn--lg" href="/pages/guias/">Empezar</a>');
    expect(html).not.toContain("style=");
  });

  it("Hero spotlight y minimal renderizan clases .ae-hero sin style inline", () => {
    const spot = elementRegistry.Hero.renderHTML({
      title: "Hola",
      subtitle: "Sub",
      variant: "spotlight",
      size: "lg",
      ctaLabel: "Ir",
      ctaHref: "/pages/a/",
    } as never);
    expect(spot).toContain('class="ae-hero ae-hero--spotlight ae-hero--lg"');
    expect(spot).toContain('class="ae-hero-cta"');
    expect(spot).not.toContain("style=");

    const min = elementRegistry.Hero.renderHTML({
      title: "Hola",
      subtitle: "Sub",
      variant: "minimal",
      size: "md",
    } as never);
    expect(min).toContain('class="ae-hero ae-hero--minimal ae-hero--md"');
    expect(min).not.toContain("style=");
  });

  it("Hero centered solo usa style inline para la variable dinamica --ve-hero-bg cuando hay bgColor", () => {
    const html = elementRegistry.Hero.renderHTML({
      title: "Hola",
      subtitle: "Sub",
      variant: "centered",
      size: "md",
      bgColor: "#131A26",
    } as never);
    expect(html).toContain('class="ae-hero ae-hero--centered ae-hero--md"');
    expect(html).toContain('style="--ve-hero-bg:#131A26;"');
    expect(html).not.toContain("padding:");
  });

  it("Spacer conserva style inline dinamico por instancia", () => {
    const html = elementRegistry.Spacer.renderHTML({ height: 48 } as never);
    expect(html).toBe('<div style="height:48px;"></div>');
  });

  it("global.css expone el puente de tokens --ve-* hacia ThemePack", () => {
    for (const token of ["--ve-card-bg", "--ve-card-border", "--ve-card-elevation", "--ve-btn-bg", "--ve-hero-radius"]) {
      expect(globalCss).toContain(token);
    }
  });
});

describe("Columns.ratio (proporciones editables + colapso movil)", () => {
  it("expone el control editable ratio en /admin/editor con las 5 opciones", () => {
    const field = elementRegistry.Columns.editableProps.find((f) => f.key === "ratio");
    expect(field).toBeDefined();
    expect(field!.kind).toBe("select");
    expect(field!.options).toEqual([...COLUMNS_RATIOS]);
  });

  it("renderiza clases de proporcion sin style inline y valida en page-schema", () => {
    for (const ratio of ["2-1", "1-2", "3-2", "2-3"] as const) {
      const html = elementRegistry.Columns.renderHTML({ count: 2, gap: 16, ratio } as never, "<div>A</div><div>B</div>");
      expect(html).toContain(`ae-columns--ratio-${ratio}`);
      expect(html).not.toContain("style=");
      expect(elementsCss).toContain(`.ae-columns--ratio-${ratio}`);
    }

    const valid = validatePageLayout({
      version: "0.1",
      slug: "bento-test",
      title: "Test",
      root: [{ id: "c1", type: "Columns", props: { count: 2, gap: 16, ratio: "2-1" } }],
    });
    expect(valid.valid).toBe(true);

    const invalid = validatePageLayout({
      version: "0.1",
      slug: "bento-test",
      title: "Test",
      root: [{ id: "c1", type: "Columns", props: { count: 2, gap: 16, ratio: "9-1" } }],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(" ")).toContain("ratio");
  });
});

describe("FeatureGrid Bento Grid y tarjetas span=2", () => {
  it("expone el control editable layout en /admin/editor", () => {
    const field = elementRegistry.FeatureGrid.editableProps.find((f) => f.key === "layout");
    expect(field).toBeDefined();
    expect(field!.kind).toBe("select");
    expect(field!.options).toEqual([...FEATURE_GRID_LAYOUTS]);
  });

  it("renderiza layout=bento y tarjetas span=2 (formato texto y formato array)", () => {
    const htmlStr = elementRegistry.FeatureGrid.renderHTML({
      title: "Arquitectura",
      layout: "bento",
      items: "server :: Nucleo :: Destacado :: span=2\nshield :: Seguridad :: Normal",
    } as never);
    expect(htmlStr).toContain('class="ae-feature-grid ae-feature-grid--bento"');
    expect(htmlStr).toContain('class="ae-feature-card ae-feature-card--span-2"');
    expect(htmlStr).toContain('class="ae-feature-card"');
    expect(htmlStr).not.toContain("span=2");
    expect(htmlStr).not.toMatch(/<(?:section|div|article|h2|h3|p)[^>]*\sstyle=/);

    const htmlArr = elementRegistry.FeatureGrid.renderHTML({
      title: "",
      layout: "bento",
      items: [
        { icon: "bot", title: "Destacada", text: "Texto", featured: true },
        { icon: "code", title: "Regular", text: "Texto", span: 1 },
      ],
    } as never);
    expect(htmlArr).toContain('class="ae-feature-card ae-feature-card--span-2"');
    expect(elementsCss).toContain(".ae-feature-grid--bento .ae-feature-card--span-2");
    expect(elementsCss).toContain("grid-column: span 2;");
  });

  it("valida layout y span en page-schema y mantiene retrocompatibilidad con starter JSONs", async () => {
    const badLayout = validatePageLayout({
      version: "0.1",
      slug: "fg",
      title: "FG",
      root: [{ id: "f1", type: "FeatureGrid", props: { title: "", layout: "masonry", items: "" } }],
    });
    expect(badLayout.valid).toBe(false);

    const badSpan = validatePageLayout({
      version: "0.1",
      slug: "fg",
      title: "FG",
      root: [{ id: "f1", type: "FeatureGrid", props: { title: "", layout: "bento", items: [{ title: "X", span: 3 }] } }],
    });
    expect(badSpan.valid).toBe(false);

    for (const rel of ["site-profiles/starter/home.json", "site-profiles/starter/pages/starter-guide.json"]) {
      const layout = JSON.parse(readFileSync(join(root, rel), "utf8"));
      expect(validatePageLayout(layout).valid, rel).toBe(true);
      const rendered = await renderPage(layout);
      expect(rendered.length, rel).toBeGreaterThan(50);
    }
  });
});
