// GET /llms.txt -- indice del contenido publico para LLMs (https://llmstxt.org).
// Se genera en build (output: "static") a partir del perfil activo
// (PORTALESS_SITE_PROFILE=starter|demo).

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSiteUrl } from "../lib/seo";
import { buildLlmsTxt, joinSiteUrl, publishedPosts } from "../lib/llms-txt";
import { CONTENT_POLICY_PATH, readContentPolicy } from "../lib/content-policy";
import { DOC_ENTRIES } from "../lib/docs-nav.mjs";
import { ROUTES } from "../lib/routes";
import { loadContentPages } from "../lib/content-pages";
import { getSiteProfileConfig } from "../lib/site-profile.mjs";

export const GET: APIRoute = async ({ site }) => {
  const profile = getSiteProfileConfig(process.env);
  const siteUrl = getSiteUrl(site);
  const url = (path: string) => joinSiteUrl(siteUrl, import.meta.env.BASE_URL, path);

  const posts = publishedPosts(await getCollection("posts"));
  const postLinks = posts.map((post) => ({
    title: post.data.title,
    url: url(`/blog/${post.id}.md`),
    note: post.data.description,
  }));

  const pageLinks = loadContentPages(profile.id).map((page) => ({
    title: page.primary.layout.title ?? page.slug,
    url: url(`${ROUTES.PAGES}/${page.slug}`),
    note: page.primary.layout.description,
  }));

  const policy = readContentPolicy();

  const docLinks = profile.features.docs
    ? DOC_ENTRIES.map((doc) => ({
        title: doc.title,
        url: url(`/docs/${doc.slug}.md`),
        note: doc.lang === "es" ? "Documentación (español)" : "Documentation (English)",
      }))
    : [];

  const body = buildLlmsTxt({
    siteName: process.env.PORTALESS_SITE_NAME || profile.defaultSiteName,
    summary: process.env.PORTALESS_SITE_DESCRIPTION || profile.defaultSiteDescription,
    sections: [
      ...(docLinks.length > 0 ? [{ heading: "Documentation", links: docLinks }] : []),
      { heading: "Posts", links: postLinks },
      { heading: profile.isDemo ? "Páginas" : "Pages", links: pageLinks },
    ],
    aiInputAllowed: policy ? policy.aiInputAllowed : true,
    policyUrl: policy ? url(CONTENT_POLICY_PATH) : undefined,
    optional: [
      {
        title: profile.isDemo ? "Feed RSS del blog" : "Blog RSS feed",
        url: url("/rss.xml"),
        note: profile.isDemo
          ? "Posts publicados, mismo filtro que /blog"
          : "Published posts, same filter as /blog",
      },
    ],
  });

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
