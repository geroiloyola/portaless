// Generador puro de sitemap.xml (https://www.sitemaps.org/protocol.html).
// No importa astro:content: el endpoint (src/pages/sitemap.xml.ts) junta las
// fuentes y le pasa entradas planas, asi se prueba con vitest.
//
// - loc: URL absoluta armada con joinSiteUrl (respeta el base de Astro).
// - lastmod: fecha W3C (YYYY-MM-DD). Se omite si no hay fecha real: un
//   lastmod falso (la fecha del build en todas las URLs) hace que los
//   buscadores dejen de confiar en el campo.
// - Escapa & < > " ' en loc, como exige el protocolo.
// - Deduplica por loc (gana la primera entrada).

import { joinSiteUrl } from "./llms-txt";

export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapEntry {
  path: string;
  lastmod?: Date;
  changefreq?: ChangeFreq;
  priority?: number;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatLastmod(date: Date | undefined): string | undefined {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

export function buildSitemapXml(siteUrl: string, base: string, entries: SitemapEntry[]): string {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const entry of entries) {
    const loc = joinSiteUrl(siteUrl, base, entry.path);
    if (seen.has(loc)) continue;
    seen.add(loc);

    const lines = [`    <loc>${escapeXml(loc)}</loc>`];
    const lastmod = formatLastmod(entry.lastmod);
    if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    if (typeof entry.priority === "number" && Number.isFinite(entry.priority)) {
      lines.push(`    <priority>${Math.min(1, Math.max(0, entry.priority)).toFixed(1)}</priority>`);
    }
    urls.push(`  <url>\n${lines.join("\n")}\n  </url>`);
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (urls.length ? `${urls.join("\n")}\n` : "") +
    "</urlset>\n"
  );
}
