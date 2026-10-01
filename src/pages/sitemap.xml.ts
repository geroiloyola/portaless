// GET /sitemap.xml -- generado en build. La logica esta en src/lib/sitemap.ts.
//
// Fuentes (mismo criterio que /llms.txt):
//   - Home y /blog/: lastmod = pubDate del post mas reciente.
//   - Posts publicados (sin borradores): lastmod = pubDate.
//   - Paginas de src/content/pages/*.json, sin barra final para coincidir con
//     su canonical en paginas/[slug].astro.
//   - Productos de la tienda si el commerce esta activo.
//
// Antes las paginas salian de page-store, que en build estatico esta vacio:
// el sitemap nunca listaba paginas ni posts y todas las URLs llevaban la
// fecha del build como lastmod. Tampoco respetaba el base de Astro.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSiteUrl } from "../lib/seo";
import { publishedPosts } from "../lib/llms-txt";
import { buildSitemapXml, type SitemapEntry } from "../lib/sitemap";

const pageModules = import.meta.glob<{ default: { slug?: string } }>("../content/pages/*.json", { eager: true });

async function collectCommerceEntries(): Promise<SitemapEntry[]> {
  try {
    const { isCommerceEnabled, fetchProducts } = await import("../commerce/medusa-client");
    if (!(await isCommerceEnabled())) return [];
    const products = await fetchProducts();
    return products
      .filter((product: any) => typeof product?.handle === "string" && product.handle.length > 0)
      .map((product: any) => ({
        path: `/tienda/${encodeURIComponent(product.handle)}`,
        changefreq: "weekly" as const,
        priority: 0.7,
      }));
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ site }) => {
  const posts = publishedPosts(await getCollection("posts"));
  const latest = posts[0]?.data.pubDate;

  const pageSlugs = Object.values(pageModules)
    .map((mod) => mod.default?.slug)
    .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);

  const entries: SitemapEntry[] = [
    { path: "/", lastmod: latest, changefreq: "weekly", priority: 1.0 },
    { path: "/blog/", lastmod: latest, changefreq: "weekly", priority: 0.6 },
    ...posts.map((post) => ({
      path: `/blog/${post.id}/`,
      lastmod: post.data.pubDate,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...pageSlugs.map((slug) => ({
      path: `/paginas/${encodeURIComponent(slug)}`,
      changefreq: "monthly" as const,
      priority: 0.8,
    })),
    ...(await collectCommerceEntries()),
  ];

  const body = buildSitemapXml(getSiteUrl(site), import.meta.env.BASE_URL, entries);
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
