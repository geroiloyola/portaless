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

/** Deja solo los posts publicados (draft !== true), del mas nuevo al mas viejo. */
export function publishedPosts<T extends { data: { draft?: boolean; pubDate: Date } }>(posts: T[]): T[] {
  return posts
    .filter((post) => post.data.draft !== true)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [`# ${oneLine(input.siteName) || "Portaless"}`, ""];
  if (input.summary && oneLine(input.summary)) lines.push(`> ${oneLine(input.summary)}`, "");

  const policyLinks: LlmsTxtLink[] = input.policyUrl
    ? [{ title: POLICY_LINK_TITLE, url: input.policyUrl, note: POLICY_LINK_NOTE }]
    : [];

  if (input.aiInputAllowed === false) {
    lines.push(AI_INPUT_BLOCKED_NOTICE, "");
    pushSection(lines, "Optional", policyLinks);
  } else {
    for (const section of input.sections) pushSection(lines, section.heading, section.links);
    pushSection(lines, "Optional", [...policyLinks, ...(input.optional ?? [])]);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
