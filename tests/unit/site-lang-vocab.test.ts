// Regla de producto: "Blog" queda anticuada para las novedades. Cada
// audiencia usa el termino que las plataformas oficiales usan:
// hispana -> "Publicaciones", global -> "Posts". Fuente unica:
// src/lib/site-lang.ts (tambien decide el lang del <html>).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_LANG, postsLabel } from "../../src/lib/site-lang";

const root = join(__dirname, "../..");
const headerSrc = readFileSync(join(root, "src/components/Header.astro"), "utf8");
const blogIndexSrc = readFileSync(join(root, "src/pages/blog/index.astro"), "utf8");
const baseLayoutSrc = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");

describe("vocabulario por audiencia (site-lang)", () => {
  it("audiencia hispana: Publicaciones", () => {
    expect(postsLabel("es")).toBe("Publicaciones");
  });

  it("audiencia global: Posts (el termino que usan las plataformas)", () => {
    expect(postsLabel("en")).toBe("Posts");
  });

  it("este sitio arranca en español y su label es Publicaciones", () => {
    expect(SITE_LANG).toBe("es");
    expect(postsLabel()).toBe("Publicaciones");
  });

  it("el <html lang> sale de la misma config que el label (nunca desincronizados)", () => {
    expect(baseLayoutSrc).toContain("<html lang={SITE_LANG} data-theme-pack=");
    expect(baseLayoutSrc).toContain('import { SITE_LANG } from "../lib/site-lang"');
  });

  it("el header anuncia las publicaciones solo si hay, y nunca dice Blog", () => {
    expect(headerSrc).toContain("publishedPosts.length > 0");
    expect(headerSrc).toContain("postsLabel()");
    expect(headerSrc).not.toMatch(/>Blog</);
  });

  it("el indice de publicaciones ya no se titula Blog", () => {
    expect(blogIndexSrc).toContain("postsLabel()");
    expect(blogIndexSrc).not.toMatch(/>Blog</);
  });
});
