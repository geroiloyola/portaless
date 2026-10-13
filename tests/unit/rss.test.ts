import { describe, expect, it } from "vitest";
import { buildRssXml, escapeXml, formatRssDate, type RssItem } from "../../src/lib/rss.ts";

const item = (overrides: Partial<RssItem> = {}): RssItem => ({
  title: "Hola",
  url: "https://a.com/blog/hola/",
  pubDate: new Date("2026-09-12T00:00:00Z"),
  description: "Primer post",
  ...overrides,
});

const feed = (items: RssItem[], extra: Record<string, unknown> = {}) =>
  buildRssXml({
    siteName: "Mi sitio",
    siteUrl: "https://a.com",
    feedUrl: "https://a.com/rss.xml",
    description: "Un blog",
    items,
    ...extra,
  });

describe("escapeXml", () => {
  it("escapa los cinco caracteres reservados", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
  });
});

describe("formatRssDate", () => {
  it("emite RFC 822 en UTC", () => {
    expect(formatRssDate(new Date("2026-09-12T00:00:00Z"))).toBe("Sat, 12 Sep 2026 00:00:00 GMT");
  });

  it("devuelve vacio ante fechas invalidas", () => {
    expect(formatRssDate(new Date("nope"))).toBe("");
  });
});

describe("buildRssXml", () => {
  it("sigue RSS 2.0 con enlace Atom self y lastBuildDate del post mas reciente", () => {
    const xml = feed([
      item({ pubDate: new Date("2026-01-01T00:00:00Z"), title: "Viejo" }),
      item({ pubDate: new Date("2026-09-12T00:00:00Z"), title: "Nuevo" }),
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
    expect(xml).toContain('<atom:link href="https://a.com/rss.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain("<lastBuildDate>Sat, 12 Sep 2026 00:00:00 GMT</lastBuildDate>");
    expect(xml).toContain("<title>Viejo</title>");
    expect(xml).toContain("<guid isPermaLink=\"true\">https://a.com/blog/hola/</guid>");
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });

  it("omite pubDate, description y link solo cuando faltan", () => {
    const xml = feed([item({ description: undefined, url: "", pubDate: new Date("nope") })]);
    expect(xml).not.toContain("<description>Primer post</description>");
    expect(xml).toContain("<description>Un blog</description>");
    expect(xml).not.toContain("<pubDate>");
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).not.toContain("<link>https://a.com/blog/hola/</link>");
    expect(xml).not.toContain("<guid");
  });

  it("escapa contenido y aplana saltos de linea", () => {
    const xml = feed([item({ title: "A & B <script>", description: "linea\nnueva" })]);
    expect(xml).toContain("<title>A &amp; B &lt;script&gt;</title>");
    expect(xml).toContain("<description>linea nueva</description>");
  });

  it("acepta feed vacio (canal valido sin items)", () => {
    const xml = feed([]);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).toContain("</channel>");
  });

  it("usa Portaless y el idioma por defecto si el nombre viene vacio", () => {
    const xml = buildRssXml({ siteName: "  ", siteUrl: "", feedUrl: "https://a.com/rss.xml", items: [] });
    expect(xml).toContain("<title>Portaless</title>");
    expect(xml).toContain("<language>es</language>");
    expect(xml).toContain("<link>/</link>");
  });
});
