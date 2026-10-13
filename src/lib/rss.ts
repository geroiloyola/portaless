// Generador puro de /rss.xml segun RSS 2.0 (mas el enlace Atom "self" que
// piden los agregadores modernos):
//   - channel: title, link, description, language, lastBuildDate.
//   - item: title, link, guid isPermaLink, pubDate (RFC 822), description.
//
// No importa astro:content ni el Trust Layer: recibe datos planos, asi se
// prueba con vitest sin compilar Astro. El endpoint (src/pages/rss.xml.ts)
// arma la entrada a partir de la coleccion "posts" filtrando borradores
// con publishedPosts(), el mismo filtro que usan /blog, el sitemap y
// llms.txt -- un borrador no puede filtrarse en un archivo si no se
// filtra en los otros.
//
// Limite honesto: no se emite content:encoded (el cuerpo del post en
// HTML). El repo no tiene un renderer markdown->HTML en build y meter una
// dependencia solo para el feed no se justifica; los lectores reciben
// titulo, permalink, fecha y descripcion.

export interface RssItem {
  title: string;
  url: string;
  pubDate: Date;
  description?: string;
}

export interface RssFeedInput {
  siteName: string;
  /** URL absoluta de este feed (rel="self"). */
  feedUrl: string;
  /** URL absoluta del sitio. */
  siteUrl: string;
  description?: string;
  language?: string;
  items: RssItem[];
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** RFC 822 en UTC: "Thu, 12 Sep 2026 00:00:00 GMT". Invalidas se omiten. */
export function formatRssDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toUTCString();
}

export function buildRssXml(input: RssFeedInput): string {
  const channelTitle = oneLine(input.siteName) || "Portaless";
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const channelLink = siteUrl || "/";
  const language = input.language || "es";
  // lastBuildDate = fecha mas reciente real del feed. No depende del orden
  // en que el caller pase los items: publishedPosts() los ordena descendente
  // y funciona igual, pero el generador no asume nada.
  const lastBuildDate = input.items.reduce<string>((acc, it) => {
    const formatted = formatRssDate(it.pubDate);
    if (!formatted) return acc;
    if (!acc || it.pubDate.getTime() > new Date(acc).getTime()) return formatted;
    return acc;
  }, "");

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channelTitle)}</title>`,
    `    <link>${escapeXml(channelLink)}</link>`,
    `    <description>${escapeXml(oneLine(input.description || ""))}</description>`,
    `    <language>${escapeXml(language)}</language>`,
    `    <atom:link href="${escapeXml(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
  ];

  if (lastBuildDate) lines.push(`    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`);

  for (const item of input.items) {
    const url = item.url.trim();
    const pubDate = formatRssDate(item.pubDate);
    const description = item.description ? oneLine(item.description) : "";
    lines.push("    <item>", `      <title>${escapeXml(oneLine(item.title))}</title>`);
    if (url) lines.push(`      <link>${escapeXml(url)}</link>`, `      <guid isPermaLink="true">${escapeXml(url)}</guid>`);
    if (pubDate) lines.push(`      <pubDate>${escapeXml(pubDate)}</pubDate>`);
    if (description) lines.push(`      <description>${escapeXml(description)}</description>`);
    lines.push("    </item>");
  }

  lines.push("  </channel>", "</rss>", "");
  return lines.join("\n");
}
