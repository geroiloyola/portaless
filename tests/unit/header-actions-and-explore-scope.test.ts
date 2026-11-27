import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePageLayout } from "../../packages/visual-elements/src/persistence/page-schema";
import {
  headerContextActionHtml,
  headerThemeToggleHtml,
} from "../../src/lib/atomic-responsive-icons";
import { renderPublicHeaderHtml } from "../../src/lib/public-shell";
import { renderShell } from "../../functions/pages/[slug].js";

const root = join(__dirname, "..", "..");

describe("PageLayout.alternateLang validation", () => {
  const baseLayout = {
    version: "0.1" as const,
    slug: "about",
    title: "About",
    root: [{ id: "h1", type: "Heading" as const, props: { text: "About", level: "h1" } }],
  };

  it("accepts valid 2-5 char language codes and safe relative hrefs", () => {
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "en", href: "/pages/en/" } }).valid).toBe(true);
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "pt-BR", href: "/pages/pt-br/" } }).valid).toBe(true);
    expect(validatePageLayout({ ...baseLayout, alternateLang: undefined }).valid).toBe(true);
  });

  it("rejects invalid language codes and unsafe hrefs (javascript:, protocol-relative, absolute)", () => {
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "e", href: "/pages/en/" } }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "english", href: "/pages/en/" } }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "en", href: "javascript:alert(1)" } }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "en", href: "//evil.example/en" } }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, alternateLang: { code: "en", href: "https://evil.example/en" } }).valid).toBe(false);
  });
});

describe("Header contextual actions, circular language button and theme toggle", () => {
  it("renders conditional circular actions (Cart, Navigate, Volume) only when context matches", () => {
    expect(headerContextActionHtml(null)).toBe("");

    const shopHtml = headerContextActionHtml("shop", "/");
    expect(shopHtml).toContain("header-icon-btn");
    expect(shopHtml).toContain('href="/shop/"');

    const mapHtml = headerContextActionHtml("map", "/");
    expect(mapHtml).toContain("header-icon-btn");
    expect(mapHtml).toContain('href="#ae-map"');

    const videoHtml = headerContextActionHtml("video", "/");
    expect(videoHtml).toContain("header-icon-btn");
    expect(videoHtml).toContain("data-portaless-volume");
  });

  it("renders circular data-theme-toggle with sun/moon icons and zero inline handlers", () => {
    const toggle = headerThemeToggleHtml("es");
    expect(toggle).toContain("header-icon-btn");
    expect(toggle).toContain("data-theme-toggle");
    expect(toggle).toContain("icon-sun");
    expect(toggle).toContain("icon-moon");
    expect(toggle).not.toMatch(/\son[a-z]+\s*=/i);

    const shellJs = readFileSync(join(root, "public/portaless-shell.js"), "utf8");
    expect(shellJs).toContain("[data-theme-toggle]");
    expect(shellJs).toContain('localStorage.setItem("portaless-theme"');
  });

  it("shows circular language switcher + hreflang link only when alternateLang is declared", () => {
    const bilingual = renderPublicHeaderHtml({
      base: "/",
      locale: "es",
      hasPosts: true,
      commerceEnabled: false,
      context: "shop",
      languageAlternate: { hreflang: "en", href: "/pages/en/", label: "EN", compact: true },
    });
    expect(bilingual).toContain("header-lang--circle");
    expect(bilingual).toContain('href="/pages/en/"');
    expect(bilingual).toContain('hreflang="en"');
    expect(bilingual).toContain("data-theme-toggle");
    expect(bilingual).toContain("data-portaless-share");
    expect(bilingual).toContain("header-context-action");

    const monolingual = renderPublicHeaderHtml({
      base: "/",
      locale: "es",
      hasPosts: true,
      commerceEnabled: false,
      context: null,
    });
    expect(monolingual).not.toMatch(/<a class="header-lang\b/);
    expect(monolingual).toContain("data-theme-toggle");
    expect(monolingual).toContain("data-portaless-share");
    expect(monolingual).not.toContain("header-context-action");

    const shellBilingual = renderShell(
      { version: "0.1", slug: "hola", title: "Hola", alternateLang: { code: "en", href: "/pages/en/" }, root: [] },
      "<p>Hola</p>",
      new Request("https://example.test/pages/hola"),
      { publicOrigin: "https://example.test" }
    );
    expect(shellBilingual).toContain('<link rel="alternate" hreflang="en" href="https://example.test/pages/en/" />');
    expect(shellBilingual).toContain("header-lang--circle");

    const shellMonolingual = renderShell(
      { version: "0.1", slug: "solo", title: "Solo", root: [] },
      "<p>Solo</p>",
      new Request("https://example.test/pages/solo"),
      { publicOrigin: "https://example.test" }
    );
    expect(shellMonolingual).not.toContain('<link rel="alternate" hreflang=');
    expect(shellMonolingual).not.toMatch(/<a class="header-lang\b/);
  });
});

describe("PageLayout.flairs validation and Visual Editor support", () => {
  const baseLayout = {
    version: "0.1" as const,
    slug: "guides",
    title: "Guides",
    root: [{ id: "h1", type: "Heading" as const, props: { text: "Guides", level: "h1" } }],
  };

  it("accepts valid flairs and omits flairs cleanly for backward compatibility", () => {
    expect(validatePageLayout({ ...baseLayout, flairs: ["Web", "Portaless", "Guías"] }).valid).toBe(true);
    expect(validatePageLayout({ ...baseLayout, flairs: undefined }).valid).toBe(true);
  });

  it("rejects >10 flairs, empty/too-long flairs, non-array, and dangerous characters", () => {
    expect(validatePageLayout({ ...baseLayout, flairs: "Web" as unknown as string[] }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, flairs: Array.from({ length: 11 }, (_, i) => `f${i}`) }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, flairs: [""] }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, flairs: ["x".repeat(33)] }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, flairs: ["<script>"] }).valid).toBe(false);
    expect(validatePageLayout({ ...baseLayout, flairs: ["bad\nflair"] }).valid).toBe(false);
  });

  it("exposes editable Flairs / Temas input in Visual Editor (editor-app.ts)", () => {
    const editorSrc = readFileSync(join(root, "packages/visual-elements/src/editor/editor-app.ts"), "utf8");
    expect(editorSrc).toContain("data-page-flairs-input");
    expect(editorSrc).toContain("Flairs / Temas");
    expect(editorSrc).toContain("draft.flairs");
  });
});

describe("ExplorePage.astro scope selector, custom flairs and URL state", () => {
  const exploreSrc = readFileSync(join(root, "src/components/ExplorePage.astro"), "utf8");

  it("renders 3 mandatory scopes (all, pages, publications) before explore-order (Order by)", () => {
    const scopeIdx = exploreSrc.indexOf('name="explore-scope"');
    const orderIdx = exploreSrc.indexOf('name="explore-order"');
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(orderIdx).toBeGreaterThan(scopeIdx);
    expect(exploreSrc).toContain('{ value: "all", label: allScopeLabel }');
    expect(exploreSrc).toContain('{ value: "pages", label: pagesLabel }');
    expect(exploreSrc).toContain('{ value: "publications", label: c.chips.publications }');
    expect(exploreSrc).toContain('data-explore-section="home"');
    expect(exploreSrc).toContain('data-explore-section="pages"');
    expect(exploreSrc).toContain('data-explore-section="publications"');
    expect(exploreSrc).toContain("data-order={buildAsOf}");
    expect(exploreSrc).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("collects dynamic flairs, emits data-flairs + flair:<slug> pills, and syncs ?flair=/?scope=/?order= URL state", () => {
    expect(exploreSrc).toContain("normalizeFlairSlug");
    expect(exploreSrc).toContain("value={`flair:${f.slug}`}");
    expect(exploreSrc).toContain("data-flairs={");
    expect(exploreSrc).toContain("explore-scope-divider");
    expect(exploreSrc).toContain("explore-flair-badge");
    expect(exploreSrc).toContain("URLSearchParams(window.location.search)");
    expect(exploreSrc).toContain('urlParams.get("flair")');
    expect(exploreSrc).toContain('urlParams.get("scope")');
    expect(exploreSrc).toContain('urlParams.get("order")');
    expect(exploreSrc).toContain("window.history.replaceState");
  });
});
