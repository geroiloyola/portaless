// tests/unit/content-subpath-urls.test.ts
// Test de regresion permanente: proteccion de subpaths (PORTALESS_BASE_PATH).
//
// Verifica que:
// 1. resolveInternalUrl anteponga correctamente el prefijo de base sin alterar URLs externas ni duplicar prefijos.
// 2. TODAS las paginas de src/content/pages/*.json renderizadas con un subpath (ej. /portaless/)
//    emitan sus enlaces y medios internos con el prefijo /portaless/ (cero 404 bajo subpaths).
// 3. /explore/ este registrado en las fuentes canónicas de src/pages/sitemap.xml.ts.
// 4. Las peticiones fetch de src/pages/trust/index.astro respeten BASE_URL.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderPage, resolveInternalUrl } from "../../packages/atomic-elements/src/render";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const root = join(__dirname, "../..");
const pagesDir = join(root, "src/content/pages");

describe("resolveInternalUrl", () => {
  it("antepone el subpath a URLs internas relativas a la raiz", () => {
    expect(resolveInternalUrl("/blog/", "/portaless/")).toBe("/portaless/blog/");
    expect(resolveInternalUrl("/trust/default", "/portaless/")).toBe("/portaless/trust/default");
    expect(resolveInternalUrl("/avatars/jerry-bantz.svg", "/portaless/")).toBe("/portaless/avatars/jerry-bantz.svg");
    expect(resolveInternalUrl("/shop/chaqueta", "/portaless/")).toBe("/portaless/shop/chaqueta");
  });

  it("es idempotente: si la URL ya tiene el prefijo no lo duplica", () => {
    expect(resolveInternalUrl("/portaless/blog/", "/portaless/")).toBe("/portaless/blog/");
    expect(resolveInternalUrl("/portaless/trust/default", "/portaless/")).toBe("/portaless/trust/default");
  });

  it("con base='/' o sin base devuelve la URL intacta", () => {
    expect(resolveInternalUrl("/blog/", "/")).toBe("/blog/");
    expect(resolveInternalUrl("/blog/", undefined)).toBe("/blog/");
    expect(resolveInternalUrl("/blog/", "")).toBe("/blog/");
  });

  it("no modifica URLs externas, esquemas especiales ni anclas", () => {
    expect(resolveInternalUrl("https://open.spotify.com/artist/x", "/portaless/")).toBe("https://open.spotify.com/artist/x");
    expect(resolveInternalUrl("http://example.com", "/portaless/")).toBe("http://example.com");
    expect(resolveInternalUrl("mailto:contacto@portaless.com", "/portaless/")).toBe("mailto:contacto@portaless.com");
    expect(resolveInternalUrl("//cdn.example.com/img.jpg", "/portaless/")).toBe("//cdn.example.com/img.jpg");
    expect(resolveInternalUrl("#ae-map", "/portaless/")).toBe("#ae-map");
  });
});

describe("paginas de src/content/pages/*.json bajo subpath (/portaless/)", () => {
  const jsonFiles = readdirSync(pagesDir).filter((f) => f.endsWith(".json"));

  for (const filename of jsonFiles) {
    it(`${filename}: ningun enlace o medio interno emitido apunta a la raiz desnuda '/' sin el subpath`, async () => {
      const raw = readFileSync(join(pagesDir, filename), "utf8");
      const layout = JSON.parse(raw) as PageLayout;

      const html = await renderPage(layout, { base: "/portaless/" });

      // Busca href="/..." y src="/..." en el HTML emitido
      const urlMatches = html.matchAll(/(?:href|src)=["'](\/[^"']*)["']/g);
      const offenders: string[] = [];

      for (const match of urlMatches) {
        const url = match[1];
        // Ignora URLs con protocolo relativo //
        if (url.startsWith("//")) continue;
        // Debe comenzar con /portaless/
        if (!url.startsWith("/portaless/")) {
          offenders.push(url);
        }
      }

      expect(offenders, `En ${filename} se encontraron URLs internas sin prefijo de subpath: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});

describe("sitemap.xml y explore hub", () => {
  it("src/pages/sitemap.xml.ts incluye /explore/ en su lista de fuentes", () => {
    const sitemapSrc = readFileSync(join(root, "src/pages/sitemap.xml.ts"), "utf8");
    expect(sitemapSrc).toContain('path: "/explore/"');
  });
});

describe("trust index client fetch", () => {
  it("src/pages/trust/index.astro respeta import.meta.env.BASE_URL en sus llamadas fetch", () => {
    const trustSrc = readFileSync(join(root, "src/pages/trust/index.astro"), "utf8");
    expect(trustSrc).toContain("import.meta.env.BASE_URL");
    expect(trustSrc).toContain("fetch(`${baseUrl}/trust/");
  });
});
