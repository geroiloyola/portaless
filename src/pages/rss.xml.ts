// GET /rss.xml -- feed RSS 2.0 de los posts publicados. Se genera en build
// (output: "static"), igual que sitemap.xml y llms.txt: en GitHub Pages
// bajo /repo/ queda en /repo/rss.xml.
//
// Fuentes: coleccion "posts" sin borradores, MISMO filtro publishedPosts()
// que /blog, el sitemap y llms.txt. Cada item enlaza al permalink publico
// (/blog/<id>/), no a la version .md: un lector de feeds abre la pagina.
//
// Limite honesto (ver src/lib/rss.ts): sin content:encoded, porque el repo
// no tiene un renderer markdown->HTML en build.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSiteUrl } from "../lib/seo";
import { buildRssXml } from "../lib/rss";
import { joinSiteUrl, publishedPosts } from "../lib/llms-txt";

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = getSiteUrl(site);
  const url = (path: string) => joinSiteUrl(siteUrl, import.meta.env.BASE_URL, path);

  const posts = publishedPosts(await getCollection("posts"));

  const body = buildRssXml({
    siteName: process.env.PORTALESS_SITE_NAME || "Portaless",
    siteUrl: url("/"),
    feedUrl: url("/rss.xml"),
    description: process.env.PORTALESS_SITE_DESCRIPTION || "Sitio construido con Portaless",
    items: posts.map((post) => ({
      title: post.data.title,
      url: url(`/blog/${post.id}/`),
      pubDate: post.data.pubDate,
      description: post.data.description,
    })),
  });

  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
