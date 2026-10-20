// Regla de producto: "Blog" queda anticuada para las novedades. Cada
// audiencia usa el termino que las plataformas oficiales usan:
// hispana -> "Publicaciones", global -> "Publications". Fuente unica: el
// catalogo i18n (src/i18n/<locale>.json), consumido por src/lib/site-lang.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_LANG, postsLabel } from "../../src/lib/site-lang";
import { renderPublicHeaderHtml } from "../../src/lib/public-shell";

const root = join(__dirname, "../..");
const headerSrc = readFileSync(join(root, "src/components/Header.astro"), "utf8");
const publicShellSrc = readFileSync(join(root, "src/lib/public-shell.ts"), "utf8");
const blogIndexSrc = readFileSync(join(root, "src/pages/blog/index.astro"), "utf8");
const baseLayoutSrc = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");

describe("vocabulario por audiencia (site-lang)", () => {
  it("audiencia hispana: Publicaciones", () => {
    expect(postsLabel("es")).toBe("Publicaciones");
  });

  it("audiencia global: Publications", () => {
    expect(postsLabel("en")).toBe("Publications");
  });

  it("este sitio arranca en español y su label es Publicaciones", () => {
    expect(SITE_LANG).toBe("es");
    expect(postsLabel()).toBe("Publicaciones");
  });

  it("el <html lang> sale de la misma config que el label (nunca desincronizados)", () => {
    // El idioma del documento es una prop (i18n, docs/i18n-design.md) cuyo
    // DEFAULT es SITE_LANG: el resto del sitio sigue atado a esa unica fuente.
    expect(baseLayoutSrc).toContain("<html lang={lang} data-theme-pack=");
    expect(baseLayoutSrc).toContain("lang = SITE_LANG");
    expect(baseLayoutSrc).toContain('import { SITE_LANG } from "../lib/site-lang"');
  });

  it("el header anuncia las publicaciones solo si hay, y nunca dice Blog", () => {
    expect(headerSrc).toContain("publishedPosts(await getCollection(\"posts\"))");
    expect(headerSrc).toContain("publicPosts.length > 0");
    expect(headerSrc).toContain("renderPublicHeaderHtml({");
    expect(publicShellSrc).toContain("postsLabel(locale)");
    expect(publicShellSrc).not.toMatch(/>Blog</);
    expect(renderPublicHeaderHtml({ base: "/", locale: "es", hasPosts: true, commerceEnabled: false }))
      .toContain('<span class="nav-txt">Publicaciones</span>');
    expect(renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: true, commerceEnabled: false }))
      .toContain('<span class="nav-txt">Publications</span>');
    expect(renderPublicHeaderHtml({ base: "/", locale: "es", hasPosts: false, commerceEnabled: false }))
      .not.toContain("/blog/");
  });

  it("el indice de publicaciones ya no se titula Blog", () => {
    expect(blogIndexSrc).toContain("postsLabel()");
    expect(blogIndexSrc).not.toMatch(/>Blog</);
  });
});
