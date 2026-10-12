// Phase 0 — visual identity foundation: un solo punto de verdad para el
// color. Cubre: (1) DEFAULT_TOKENS = paleta oficial con accentText;
// (2) TOKEN_TO_CSS_VAR incluye accentText; (3) base.json declara la misma
// paleta oficial; (4) global.css aliasa --portaless-* a los tokens y
// trae el dark mode oficial; (5) el renderHTML de atomic-elements usa
// var(--token, fallback) y ya no trae el hex de marca viejo; (6) los
// skins derivados declaran accentText oscurecido (legible sobre fondo
// claro).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TOKENS,
  DEFAULT_DARK_TOKENS,
  TOKEN_TO_CSS_VAR,
  applyDesignTokens,
} from "../../packages/dashboard/src/skin-engine/tokens";
import { elementRegistry, elementPalette } from "../../packages/atomic-elements/src/elements/registry";
import baseManifest from "../../packages/dashboard/src/skins/base.json";
import blogManifest from "../../packages/dashboard/src/skins/blog.json";
import tiendaManifest from "../../packages/dashboard/src/skins/tienda.json";
import trustCrmManifest from "../../packages/dashboard/src/skins/trust-crm.json";

const root = join(__dirname, "../..");
const globalCss = readFileSync(join(root, "src/styles/global.css"), "utf8");

describe("paleta oficial (DEFAULT_TOKENS)", () => {
  it("es la paleta oficial: lima / tinta / hueso / salvia / naranja", () => {
    expect(DEFAULT_TOKENS.accent).toBe("#C5D86D");
    expect(DEFAULT_TOKENS.accent2).toBe("#F05D23");
    expect(DEFAULT_TOKENS.bg).toBe("#F7F7F2");
    expect(DEFAULT_TOKENS.text).toBe("#261C15");
    expect(DEFAULT_TOKENS.panelBorder).toBe("#E4E6C3");
  });

  it("accentText existe y NO es el accent puro (regla de contraste)", () => {
    expect(DEFAULT_TOKENS.accentText).toBeDefined();
    expect(DEFAULT_TOKENS.accentText).not.toBe(DEFAULT_TOKENS.accent);
    expect(TOKEN_TO_CSS_VAR.accentText).toBe("--accent-text");
  });

  it("el dark mode oficial usa #261C15 de fondo y #F7F7F2 de texto", () => {
    expect(DEFAULT_DARK_TOKENS.bg).toBe("#261C15");
    expect(DEFAULT_DARK_TOKENS.text).toBe("#F7F7F2");
    expect(DEFAULT_DARK_TOKENS.accent).toBe("#C5D86D");
  });

  it("applyDesignTokens escribe accentText como --accent-text en el root", () => {
    const set = new Map<string, string>();
    const fakeRoot = {
      style: { setProperty: (k: string, v: string) => set.set(k, v) },
    } as unknown as HTMLElement;
    applyDesignTokens({ accent: "#C5D86D", accentText: "#5A6B24" }, fakeRoot);
    expect(set.get("--accent")).toBe("#C5D86D");
    expect(set.get("--accent-text")).toBe("#5A6B24");
  });
});

describe("base.json = paleta oficial", () => {
  it("declara los mismos valores oficiales que DEFAULT_TOKENS", () => {
    const t = (baseManifest as { tokens: Record<string, string> }).tokens;
    expect(t.accent).toBe(DEFAULT_TOKENS.accent);
    expect(t.accentText).toBe(DEFAULT_TOKENS.accentText);
    expect(t.accent2).toBe(DEFAULT_TOKENS.accent2);
    expect(t.bg).toBe(DEFAULT_TOKENS.bg);
    expect(t.text).toBe(DEFAULT_TOKENS.text);
    expect(t.panelBg).toBe(DEFAULT_TOKENS.panelBg);
    expect(t.panelBorder).toBe(DEFAULT_TOKENS.panelBorder);
    expect(t.muted).toBe(DEFAULT_TOKENS.muted);
  });

  it("los skins derivados declaran accentText oscurecido", () => {
    for (const manifest of [blogManifest, tiendaManifest, trustCrmManifest]) {
      const t = (manifest as { tokens: Record<string, string> }).tokens;
      expect(t.accentText, (manifest as { skin: string }).skin).toBeDefined();
      expect(t.accentText).not.toBe(t.accent);
    }
  });
});

describe("global.css: aliases y dark mode", () => {
  it("aliasa --portaless-* a los tokens (no a valores propios)", () => {
    expect(globalCss).toContain("--portaless-bg: var(--bg)");
    expect(globalCss).toContain("--portaless-fg: var(--text)");
    expect(globalCss).toContain("--portaless-accent: var(--accent)");
    expect(globalCss).toContain("--portaless-muted: var(--muted)");
    expect(globalCss).toContain("--portaless-border: var(--panel-border)");
  });

  it("define la paleta oficial en :root con --accent-text", () => {
    expect(globalCss).toContain("--accent: #C5D86D");
    expect(globalCss).toContain("--accent-text: #5A6B24");
    expect(globalCss).toContain("--bg: #F7F7F2");
    expect(globalCss).toContain("--text: #261C15");
  });

  it("trae dark mode por prefers-color-scheme y por data-theme", () => {
    expect(globalCss).toContain("@media (prefers-color-scheme: dark)");
    expect(globalCss).toContain(':root[data-theme="dark"]');
    expect(globalCss).toContain("--bg: #261C15");
    expect(globalCss).toContain("--text: #F7F7F2");
  });

  it("los enlaces usan --accent-text, nunca el lima puro como texto", () => {
    expect(globalCss).toMatch(/a \{ color: var\(--accent-text\)/);
  });
});

describe("atomic-elements: renderHTML responde al skin", () => {
  it("ningun renderer trae el hex de marca viejo", () => {
    for (const type of elementPalette) {
      const html = elementRegistry[type].renderHTML(
        { ...elementRegistry[type].defaultProps } as never,
        "<span>hijo</span>"
      );
      expect(html, type).not.toContain("#6ee7b7");
      expect(html, type).not.toContain("#0a0b0f");
      expect(html, type).not.toContain("#1c2029");
    }
  });

  it("Button primario usa var(--accent, ...) de fondo y tinta #261C15 de texto", () => {
    const html = elementRegistry.Button.renderHTML({ label: "Ir", href: "#", style: "primary" } as never);
    expect(html).toContain("background:var(--accent, #C5D86D)");
    expect(html).toContain("color:#261C15");
  });

  it("Button secundario usa --accent-text (contraste sobre fondo claro)", () => {
    const html = elementRegistry.Button.renderHTML({ label: "Ir", href: "#", style: "secondary" } as never);
    expect(html).toContain("var(--accent-text, #5A6B24)");
    expect(html).toContain("1px solid var(--accent, #C5D86D)");
  });

  it("LinkList solido replica el patron primary del Button", () => {
    const html = elementRegistry.LinkList.renderHTML({
      title: "x",
      links: [{ label: "a", url: "https://x", enabled: true }],
      buttonStyle: "solid",
    } as never);
    expect(html).toContain("var(--accent, #C5D86D)");
    expect(html).not.toContain("#6ee7b7");
  });

  it("los defaults de Hero y Perfil usan la tinta oficial (#261C15)", () => {
    expect(elementRegistry.Hero.defaultProps.bgColor).toBe("#261C15");
    expect(elementRegistry.ProfileHeader.defaultProps.bgColor).toBe("#261C15");
  });

  it("ProductGrid de placeholder usa bordes/texto de token con fallback", () => {
    const html = elementRegistry.ProductGrid.renderHTML({ source: "medusa", columns: 3, limit: 6 } as never);
    expect(html).toContain("var(--panel-border, #E4E6C3)");
    expect(html).toContain("var(--muted, #6E6653)");
  });
});
