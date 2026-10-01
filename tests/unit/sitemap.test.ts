import { describe, expect, it } from "vitest";
import { buildSitemapXml, escapeXml, formatLastmod } from "../../src/lib/sitemap.ts";

describe("escapeXml", () => {
  it("escapa los cinco caracteres reservados", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("formatLastmod", () => {
  it("usa formato W3C y descarta fechas invalidas", () => {
    expect(formatLastmod(new Date("2026-09-30T23:10:00Z"))).toBe("2026-09-30");
    expect(formatLastmod(new Date("no es fecha"))).toBeUndefined();
    expect(formatLastmod(undefined)).toBeUndefined();
  });
});

describe("buildSitemapXml", () => {
  it("arma URLs absolutas con base, lastmod real y prioridades", () => {
    const xml = buildSitemapXml("https://a.com", "/repo/", [
      { path: "/", lastmod: new Date("2026-09-01T00:00:00Z"), changefreq: "weekly", priority: 1 },
      { path: "/blog/hola/", lastmod: new Date("2026-08-15T00:00:00Z"), changefreq: "monthly", priority: 0.7 },
      { path: "/paginas/inicio", changefreq: "monthly", priority: 0.8 },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')).toBe(true);
    expect(xml).toContain("<loc>https://a.com/repo/</loc>\n    <lastmod>2026-09-01</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>");
    expect(xml).toContain("<loc>https://a.com/repo/blog/hola/</loc>\n    <lastmod>2026-08-15</lastmod>");
    expect(xml).toContain("<loc>https://a.com/repo/paginas/inicio</loc>\n    <changefreq>monthly</changefreq>");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("no inventa lastmod cuando no hay fecha", () => {
    const xml = buildSitemapXml("https://a.com", "/", [{ path: "/paginas/x" }]);
    expect(xml).not.toContain("<lastmod>");
  });

  it("escapa el loc y deduplica", () => {
    const xml = buildSitemapXml("https://a.com", "/", [
      { path: "/tienda/a&b" },
      { path: "/tienda/a&b" },
    ]);
    expect(xml).toContain("<loc>https://a.com/tienda/a&amp;b</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });

  it("limita priority a 0..1 e ignora valores no numericos", () => {
    const xml = buildSitemapXml("https://a.com", "/", [
      { path: "/a", priority: 3 },
      { path: "/b", priority: -1 },
      { path: "/c", priority: Number.NaN },
    ]);
    expect(xml).toContain("<loc>https://a.com/a</loc>\n    <priority>1.0</priority>");
    expect(xml).toContain("<loc>https://a.com/b</loc>\n    <priority>0.0</priority>");
    expect(xml).toContain("<loc>https://a.com/c</loc>\n  </url>");
  });

  it("sin entradas genera un urlset valido y vacio", () => {
    expect(buildSitemapXml("https://a.com", "/", [])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n'
    );
  });
});
