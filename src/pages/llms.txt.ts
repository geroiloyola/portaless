// GET /llms.txt -- indice del contenido publico para LLMs (https://llmstxt.org).
// Se genera en build (output: "static"). Respeta el base de Astro: en GitHub
// Pages bajo /repo/ queda en /repo/llms.txt, que la especificacion v2 acepta
// (un llms.txt describe lo que esta bajo su path).
//
// Fuentes:
//   - Posts: coleccion "posts" sin borradores, enlazados a su version .md.
//   - Paginas: src/content/pages/*.json (Atomic Elements), enlazadas a su
//     HTML porque no son markdown. El contenido editado en la tabla pages de
//     D1/SQLite no existe en build y queda afuera.
//   - Politica: si public/.well-known/portaless-content-policy.json bloquea
//     ai_input, no se lista contenido (ver src/lib/llms-txt.ts).
//
// Nombre y resumen: PORTALESS_SITE_NAME y PORTALESS_SITE_DESCRIPTION.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSiteUrl } from "../lib/seo";
import { buildLlmsTxt, joinSiteUrl, publishedPosts } from "../lib/llms-txt";
import { CONTENT_POLICY_PATH, readContentPolicy } from "../lib/content-policy";

interface PageJson {
  slug?: string;
  title?: string;
  description?: string;
}

const pageModules = import.meta.glob<{ default: PageJson }>("../content/pages/*.json", { eager: true });

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = getSiteUrl(site);
  const url = (path: string) => joinSiteUrl(siteUrl, import.meta.env.BASE_URL, path);

  const posts = publishedPosts(await getCollection("posts"));
  const postLinks = posts.map((post) => ({
    title: post.data.title,
    url: url(`/blog/${post.id}.md`),
    note: post.data.description,
  }));

  const pageLinks = Object.values(pageModules)
    .map((mod) => mod.default)
    .filter((page): page is PageJson & { slug: string } => typeof page?.slug === "string" && page.slug.length > 0)
    .map((page) => ({
      title: page.title ?? page.slug,
      url: url(`/paginas/${page.slug}`),
      note: page.description,
    }));

  const policy = readContentPolicy();

  const body = buildLlmsTxt({
    siteName: process.env.PORTALESS_SITE_NAME || "Portaless",
    summary: process.env.PORTALESS_SITE_DESCRIPTION || "Sitio construido con Portaless",
    sections: [
      { heading: "Posts", links: postLinks },
      { heading: "Páginas", links: pageLinks },
    ],
    aiInputAllowed: policy ? policy.aiInputAllowed : true,
    policyUrl: policy ? url(CONTENT_POLICY_PATH) : undefined,
  });

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
