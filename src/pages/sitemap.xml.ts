import type { APIRoute } from "astro";
import { getSiteUrl } from "../lib/seo";

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: number;
}

async function collectPageSlugs(): Promise<string[]> {
  try {
    const mod: any = await import("../../packages/atomic-elements/src/persistence/page-store");
    const store = mod.pageStore ?? mod.defaultPageStore ?? mod;
    for (const methodName of ["listAllPageSlugs", "listSlugs", "getAllSlugs", "list", "listPages"]) {
      const candidate = mod[methodName] ?? store?.[methodName];
      if (typeof candidate === "function") {
        const result = await candidate.call(store?.[methodName] ? store : undefined);
        if (Array.isArray(result)) {
          return result.map((item: any) => (typeof item === "string" ? item : item?.slug)).filter(Boolean);
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

async function collectCommerceUrls(siteUrl: string): Promise<SitemapUrl[]> {
  try {
    const { isCommerceEnabled, fetchProducts } = await import("../commerce/medusa-client");
    const enabled = await isCommerceEnabled();
    if (!enabled) return [];
    const products = await fetchProducts();
    return products.map((product: any) => ({
      loc: `${siteUrl}/tienda/${product.handle}`,
      changefreq: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = getSiteUrl(site);
  const now = new Date().toISOString();

  const urls: SitemapUrl[] = [
    { loc: `${siteUrl}/`, lastmod: now, changefreq: "weekly", priority: 1.0 },
    { loc: `${siteUrl}/blog`, changefreq: "weekly", priority: 0.6 },
  ];

  const pageSlugs = await collectPageSlugs();
  for (const slug of pageSlugs) {
    urls.push({ loc: `${siteUrl}/paginas/${slug}`, lastmod: now, changefreq: "monthly", priority: 0.8 });
  }

  urls.push(...(await collectCommerceUrls(siteUrl)));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}\n    ${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ""}\n    ${u.priority !== undefined ? `<priority>${u.priority.toFixed(1)}</priority>` : ""}\n  </url>`).join("\n")}
</urlset>
`;

  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
