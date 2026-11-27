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

describe("ExplorePage.astro scope selector above Order by", () => {
  const exploreSrc = readFileSync(join(root, "src/components/ExplorePage.astro"), "utf8");

  it("renders explore-scope radiogroup before explore-order (Order by)", () => {
    const scopeIdx = exploreSrc.indexOf('name="explore-scope"');
    const orderIdx = exploreSrc.indexOf('name="explore-order"');
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(orderIdx).toBeGreaterThan(scopeIdx);
    expect(exploreSrc).toContain('data-explore-section="home"');
    expect(exploreSrc).toContain('data-explore-section="pages"');
    expect(exploreSrc).toContain('data-explore-section="publications"');
    expect(exploreSrc).toContain("data-order={buildAsOf}");
    expect(exploreSrc).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
