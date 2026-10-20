// Generador puro de /llms.txt segun https://llmstxt.org (v2):
//   - H1 con el nombre del sitio (unica parte obligatoria).
//   - Blockquote con un resumen corto.
//   - Secciones H2 con listas de links "- [nombre](url): nota".
//   - "## Optional": por convencion, lo que un agente puede saltear.
//
// No importa astro:content ni el Trust Layer: recibe datos planos, asi se
// prueba con vitest sin compilar Astro. El endpoint (src/pages/llms.txt.ts)
// arma la entrada a partir de las colecciones y del manifiesto de politicas.
//
// Coherencia con el Trust Layer: si la politica del sitio bloquea ai_input
// (Content-Signal: ai-input=no en robots.txt), el llms.txt NO lista
// contenido; solo el H1, el resumen, un aviso y el link a la politica. Un
// indice para LLMs no deberia ofrecer lo que el sitio no autoriza a usar.
import { isPubliclyPublishable } from "../../packages/deploy-engine/src/draft-filter";

export interface LlmsTxtLink {
  title: string;
  url: string;
  note?: string;
}

export interface LlmsTxtSection {
  heading: string;
  links: LlmsTxtLink[];
}

export interface LlmsTxtInput {
  siteName: string;
  summary?: string;
  sections: LlmsTxtSection[];
  optional?: LlmsTxtLink[];
  /** false si el manifiesto de politicas bloquea ai_input. Default: true. */
  aiInputAllowed?: boolean;
  /** URL absoluta de /.well-known/portaless-content-policy.json. */
  policyUrl?: string;
}

export const POLICY_LINK_TITLE = "Política de contenido";
export const POLICY_LINK_NOTE = "Condiciones de uso, pago y excepciones por operador";
export const AI_INPUT_BLOCKED_NOTICE =
  "El propietario de este sitio no autoriza el uso de su contenido como entrada para modelos de IA (Content-Signal: ai-input=no). Consulta la política de contenido antes de usarlo.";
/**
 * Marca emitida (solo) cuando la política bloquea ai_input. Un commentario
 * en el texto no afecta a los lectores, pero functions/llms.txt.js la usa
 * para NO inyectar las páginas de la base de datos sobre un índice que el
 * dueño declaró cerrado: la política manda sobre la disponibilidad técnica.
 */
export const AI_INPUT_BLOCKED_MARKER = "<!-- portaless:ai-input-blocked -->";

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeLinkText(text: string): string {
  return oneLine(text).replace(/([\\\[\]])/g, "\\$1");
}

function escapeUrl(url: string): string {
  return url
    .trim()
    .replace(/\s/g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function formatLink(link: LlmsTxtLink): string {
  const url = escapeUrl(link.url);
  const title = escapeLinkText(link.title) || url;
  const note = link.note ? oneLine(link.note) : "";
  return `- [${title}](${url})${note ? `: ${note}` : ""}`;
}

function pushSection(lines: string[], heading: string, links: LlmsTxtLink[]) {
  if (links.length === 0) return;
  lines.push(`## ${oneLine(heading)}`, "");
  for (const link of links) lines.push(formatLink(link));
  lines.push("");
}

/** Une la URL del sitio (sin barra final, como getSiteUrl()), el base de Astro y un path. */
export function joinSiteUrl(siteUrl: string, base: string, path: string): string {
  const site = siteUrl.replace(/\/+$/, "");
  const prefix = `/${base}`.replace(/\/+/g, "/").replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${site}${prefix}${suffix}`;
}

/** Deja solo los posts publicables (no draft/private), del mas nuevo al mas viejo. */
export function publishedPosts<T extends { id: string; data: { draft?: boolean; private?: boolean; pubDate: Date } }>(posts: T[]): T[] {
  return posts
    .filter((post) => isPubliclyPublishable({
      slug: post.id,
      draft: post.data.draft,
      visibility: post.data.private ? "private" : "public",
    }))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [`# ${oneLine(input.siteName) || "Portaless"}`, ""];
  if (input.summary && oneLine(input.summary)) lines.push(`> ${oneLine(input.summary)}`, "");

  const policyLinks: LlmsTxtLink[] = input.policyUrl
    ? [{ title: POLICY_LINK_TITLE, url: input.policyUrl, note: POLICY_LINK_NOTE }]
    : [];

  if (input.aiInputAllowed === false) {
    lines.push(AI_INPUT_BLOCKED_MARKER, AI_INPUT_BLOCKED_NOTICE, "");
    pushSection(lines, "Optional", policyLinks);
  } else {
    for (const section of input.sections) pushSection(lines, section.heading, section.links);
    pushSection(lines, "Optional", [...policyLinks, ...(input.optional ?? [])]);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Fusion de paginas editadas en la base de datos (Phase 6)
// ---------------------------------------------------------------------------

export interface DbPageEntry {
  slug: string;
  title?: string;
  description?: string;
}

/** Slug de /pages/<slug> ya presentes en un llms.txt (para no duplicar). */
export function listedPageSlugs(llmsTxt: string): Set<string> {
  const slugs = new Set<string>();
  const pattern = /\/pages\/([^)\s/]+)\)/g;
  for (const match of llmsTxt.matchAll(pattern)) slugs.add(decodeURIComponent(match[1]));
  return slugs;
}

/**
 * Agrega una seccion a un llms.txt ya generado, ANTES de "## Optional" (que
 * es el ultimo bloque por convencion). Si no hay Optional, va al final.
 * Devuelve el texto igual si la seccion esta vacia: un merge que no cambia
 * nada debe poder compararse con === y devolver la respuesta estatica tal.
 */
export function appendLlmsTxtSection(base: string, section: LlmsTxtSection): string {
  if (section.links.length === 0) return base;
  const block = [`## ${oneLine(section.heading)}`, "", ...section.links.map(formatLink)].join("\n");
  const text = base.replace(/\s+$/, "");
  const marker = "\n## Optional";
  const idx = text.indexOf(marker);
  if (idx === -1) return `${text}\n\n${block}\n`;
  return `${text.slice(0, idx)}\n\n${block}\n${text.slice(idx)}\n`;
}

/**
 * Fusiona las paginas de la tabla `pages` (D1/SQLite) en el llms.txt que el
 * build estatico ya emite. Reglas:
 *   - la politica bloqueada (marcador) gana: no se lista nada agregado;
 *   - un slug ya presente en el build no se repite (las de
 *     src/content/pages/*.json ya estan listadas ahi);
 *   - titulo por defecto = slug, descripcion solo si la tiene.
 * La URL la decide el caller (self-host y Cloudflare Pages conocen el site
 * URL en runtime; el build estatico no llega aca).
 */
export function mergeDbPagesIntoLlmsTxt(
  base: string,
  pages: DbPageEntry[],
  toUrl: (slug: string) => string
): string {
  if (base.includes(AI_INPUT_BLOCKED_MARKER)) return base;
  const existing = listedPageSlugs(base);
  const links: LlmsTxtLink[] = [];
  for (const page of pages) {
    if (typeof page?.slug !== "string" || page.slug.length === 0) continue;
    if (existing.has(page.slug)) continue;
    existing.add(page.slug);
    links.push({
      title: oneLine(page.title || "") || page.slug,
      url: toUrl(page.slug),
      note: page.description,
    });
  }
  return appendLlmsTxtSection(base, { heading: "Páginas del editor", links });
}
