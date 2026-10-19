// Sprint UI/UX movil. Tres contratos sobre la capa de UI:
//   1. Cero JS para layout: el responsive vive en CSS Grid/clamp()/min() y no
//      hay window.innerWidth ni listeners de resize en el sitio publico.
//   2. Objetivos tactiles 44x44 (WCAG 2.5.5) en header, footer y los controles
//      de los atomos.
//   3. Fidelidad al sistema de diseno: el gutter sale de la escala de espaciado
//      (--space-*), no de pixeles magicos.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const globalCss = readFileSync(join(root, "src/styles/global.css"), "utf8");
const elementsCss = readFileSync(join(root, "packages/atomic-elements/src/styles/elements.css"), "utf8");
const registry = readFileSync(join(root, "packages/atomic-elements/src/elements/registry.ts"), "utf8");

describe("gutter fluido derivado del sistema de diseno", () => {
  it("--gutter es clamp(--space-3, 5vw, --space-6)", () => {
    expect(globalCss).toContain("--gutter: clamp(var(--space-3), 5vw, var(--space-6));");
  });

  it(".container y el header usan var(--gutter), no un 1.25rem magico", () => {
    expect(globalCss).toMatch(/\.container \{[\s\S]*?padding: 2rem var\(--gutter\);/);
    expect(globalCss).toMatch(/header\.site-header nav \{[\s\S]*?padding: 1rem var\(--gutter\);/);
    // El gutter de las dos superficies ya no es un literal.
    expect(globalCss).not.toMatch(/padding: (1rem|2rem) 1\.25rem/);
  });

  it("FeatureGrid usa minmax(min(100%, 280px), 1fr) -- nunca desborda a 320px", () => {
    expect(registry).toContain("repeat(auto-fit, minmax(min(100%, 280px), 1fr))");
  });
});

describe("objetivos tactiles 44x44 (WCAG 2.5.5)", () => {
  it("los controles del header miden 44x44", () => {
    // nav-link (movil), header-lang, header-trust, header-icon-btn.
    const widths = globalCss.match(/width: 44px;/g) ?? [];
    const heights = globalCss.match(/height: 44px;/g) ?? [];
    expect(widths.length).toBeGreaterThanOrEqual(4);
    expect(heights.length).toBeGreaterThanOrEqual(4);
  });

  it("los enlaces del footer centran el texto con min-height: 44px", () => {
    expect(globalCss).toMatch(/footer\.site-footer \.footer-eco a \{[\s\S]*?min-height: 44px;/);
  });

  it("Button y Hero CTA declaran el objetivo tactil inline (min 44x44 + centrado)", () => {
    expect(registry).toContain("min-height:44px;min-width:44px;");
    expect(registry).toMatch(/TOUCH_TARGET/);
    // El boton ya no es display:inline-block (no centra ni garantiza el alto).
    expect(registry).not.toMatch(/href="\$\{esc\(p\.href\)\}" style="display:inline-block/);
  });

  it("la hoja cubre los controles de accion de los atomos con puntero grueso", () => {
    const block = elementsCss.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(block![1]).toContain("min-height: 44px");
    expect(block![1]).toContain("min-width: 44px");
  });
});

describe("cero JS para layout", () => {
  it("el sitio publico no usa window.innerWidth ni listeners de resize", () => {
    for (const src of [globalCss, elementsCss]) {
      expect(src).not.toContain("window.innerWidth");
      expect(src).not.toContain("addEventListener(\"resize\"");
    }
  });
});

describe("paridad static <-> runtime (functions/pages/[slug].js)", () => {
  const shellCss = readFileSync(join(root, "functions/pages/[slug].js"), "utf8");

  it("el shell runtime usa el mismo gutter fluido", () => {
    expect(shellCss).toContain("--gutter:clamp(var(--space-3,12px),5vw,var(--space-6,24px))");
    expect(shellCss).toContain("padding:2rem var(--gutter)");
  });

  it("el shell runtime tambien aplica 44x44 a los controles", () => {
    expect(shellCss).toContain("width:44px;height:44px"); // nav-link/lang/trust/icon-btn
    expect(shellCss).toContain("min-height:44px"); // footer links
  });
});
