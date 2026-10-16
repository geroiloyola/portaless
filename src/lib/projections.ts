// Un canon, cinco proyecciones (ROADMAP fase 13, §13.4).
//
// El principio es de docs/VISION.md ("One canon, many projections"): el nodo
// tiene UN estado canonico y todo lo que publica hacia afuera -- una pagina,
// un feed, un manifiesto, una entrada de indice, un post en otra plataforma --
// es una PROYECCION derivada de ese estado, nunca una segunda fuente de verdad.
// Cuando una proyeccion y el canon no coinciden, gana el canon y la proyeccion
// se reconstruye.
//
// Este modulo es puro (no importa astro:content) para poder probarse con
// vitest: recibe el canon en campos planos y reutiliza los MISMOS generadores
// que emiten /rss.xml, /llms.txt y /sitemap.xml -- por eso la demo no puede
// inventar un valor que las rutas reales no publicarian. "match" es true/false
// cuando la proyeccion se puede derivar y comparar en el build (pagina, feed,
// indice) y null cuando necesita un nodo con functions/ (manifiesto firmado,
// sindicacion POSSE): en ese caso la demo NO finge un check verde.

import { buildRssXml, escapeXml } from "./rss";
import { buildLlmsTxt, joinSiteUrl, type LlmsTxtSection } from "./llms-txt";
import { buildSitemapXml } from "./sitemap";
import { buildSiteManifest } from "../../packages/apw-resolver/src/did-apw/site-manifest";

export interface Canon {
  kind: "post";
  id: string;
  /** Ruta del archivo fuente: es la fuente de verdad, no una copia. */
  source: string;
  title: string;
  description: string;
  pubDate: Date;
  /** Ruta publica sin barra final, ej. "/blog/bienvenida". */
  path: string;
}

export interface ProjectionContext {
  /** URL del sitio sin barra final, como getSiteUrl(). */
  siteUrl: string;
  /** base de Astro, ej. "/" o "/repo". */
  base: string;
  siteName: string;
  summary?: string;
  /** Dominio servido; siteId del manifiesto APW. */
  siteId: string;
}

export type ProjectionState = "live" | "node";
// true = la proyeccion deriva del canon y coincide; false = no coincide (gana
// el canon); null = no verificable en este build (necesita un nodo).
export type ProjectionMatch = boolean | null;

export interface Projection {
  id: "page" | "feed" | "manifest" | "index" | "platform";
  title: string;
  channel: string;
  state: ProjectionState;
  /** Donde mirar la proyeccion (en estatico puede ser una ruta que no existe). */
  href: string;
  /** El valor realmente derivado del canon, tal cual sale del generador. */
  derived: string;
  match: ProjectionMatch;
  note: string;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function canonicalUrl(canon: Canon, ctx: ProjectionContext): string {
  return joinSiteUrl(ctx.siteUrl, ctx.base, `${canon.path}/`);
}

export function markdownUrl(canon: Canon, ctx: ProjectionContext): string {
  return joinSiteUrl(ctx.siteUrl, ctx.base, `${canon.path}.md`);
}

/**
 * ¿El texto generado (feed, sitemap o llms.txt) contiene el canon y su URL?
 * Es la regla "gana el canon" en una funcion: si un listado no lleva el titulo
 * y la URL de ESTE canon, no coincide y hay que reconstruirlo desde el canon.
 * Acepta la forma cruda y la escapada porque cada generador escapa distinto.
 */
export function containsCanon(text: string, canon: Canon, url: string): boolean {
  const title = oneLine(canon.title);
  const titleOk = text.includes(title) || text.includes(escapeXml(title));
  return titleOk && containsUrl(text, url);
}

/** ¿El texto contiene la URL canonica (cruda o escapada)? Un sitemap solo lleva URLs. */
export function containsUrl(text: string, url: string): boolean {
  return text.includes(url) || text.includes(escapeXml(url));
}

/** Las cinco proyecciones, en el orden con que VISION.md las enumera. */
export function projectionsFor(canon: Canon, ctx: ProjectionContext): Projection[] {
  const url = canonicalUrl(canon, ctx);
  const title = oneLine(canon.title);
  const description = oneLine(canon.description);
  const rel = ctx.base.replace(/\/+$/, "");

  // 1. Pagina (HTML): el canon renderizado por Astro. No hay copia que
  //    comparar -- es el mismo dato -- asi que coincide por construccion.
  const page: Projection = {
    id: "page",
    title: "Página",
    channel: "HTML",
    state: "live",
    href: `${rel}${canon.path}/`,
    derived: `${title}\n${url}`,
    match: true,
    note: "Renderizada desde el canon por el build de Astro. Es la proyección que abre una persona.",
  };

  // 2. Feed (RSS 2.0): mismo builder que /rss.xml.
  const feedXml = buildRssXml({
    siteName: ctx.siteName,
    siteUrl: joinSiteUrl(ctx.siteUrl, ctx.base, "/"),
    feedUrl: joinSiteUrl(ctx.siteUrl, ctx.base, "/rss.xml"),
    description: ctx.summary,
    items: [{ title, url, pubDate: canon.pubDate, description }],
  });
  const feed: Projection = {
    id: "feed",
    title: "Feed",
    channel: "RSS 2.0",
    state: "live",
    href: joinSiteUrl(ctx.siteUrl, ctx.base, "/rss.xml"),
    derived: feedXml.match(/<item>[\s\S]*?<\/item>/)?.[0] ?? "",
    match: containsCanon(feedXml, canon, url),
    note: "Un lector de feeds abre el permalink canónico, nunca una copia.",
  };

  // 3. Manifiesto (APW): firmado por request en un nodo con identidad. Se
  //    muestra la forma real (buildSiteManifest) pero sin fingir que existe
  //    un archivo firmado en hosting estático.
  const manifest = buildSiteManifest(ctx.siteId);
  const manifestProjection: Projection = {
    id: "manifest",
    title: "Manifiesto",
    channel: "APW · /.well-known",
    state: "node",
    href: joinSiteUrl(ctx.siteUrl, ctx.base, "/.well-known/apw-manifest.jws"),
    derived: JSON.stringify(manifest, null, 2),
    match: null,
    note: "Firmado por request (Ed25519) en un nodo con identidad. En el demo estático no existe: se muestra la forma, no un archivo.",
  };

  // 4. Indice (llms.txt + sitemap.xml): los dos listados publican la misma URL.
  const sections: LlmsTxtSection[] = [
    { heading: "Publicaciones", links: [{ title, url, note: description }] },
  ];
  const llms = buildLlmsTxt({
    siteName: ctx.siteName,
    summary: ctx.summary,
    sections,
    aiInputAllowed: true,
  });
  const sitemap = buildSitemapXml(ctx.siteUrl, ctx.base, [
    { path: `${canon.path}/`, lastmod: canon.pubDate },
  ]);
  const llmsLine = llms.split("\n").find((line) => line.includes(title) && line.includes(url)) ?? "";
  const sitemapEntry = sitemap.match(/<url>[\s\S]*?<\/url>/)?.[0] ?? "";
  const index: Projection = {
    id: "index",
    title: "Índice",
    channel: "llms.txt + sitemap.xml",
    state: "live",
    href: joinSiteUrl(ctx.siteUrl, ctx.base, "/llms.txt"),
    derived: [llmsLine, sitemapEntry].filter(Boolean).join("\n"),
    match: containsCanon(llms, canon, url) && containsUrl(sitemap, url),
    note: "Los dos listados publican la MISMA URL canónica; si uno cambia, el índice se reconstruye desde el canon.",
  };

  // 5. Otra plataforma (POSSE): el espejo que siempre enlaza de vuelta.
  const platform: Projection = {
    id: "platform",
    title: "Otra plataforma",
    channel: "POSSE · Bluesky / Mastodon",
    state: "node",
    href: `${rel}/admin/permissions/`,
    derived: `${title} — ${url}`,
    match: null,
    note: "El plugin posse-syndicator publica este espejo y enlaza de vuelta al canon. Requiere content:read y network:fetch en el Centro de Permisos.",
  };

  return [page, feed, manifestProjection, index, platform];
}

export const PROJECTION_IDS: ReadonlyArray<Projection["id"]> = [
  "page",
  "feed",
  "manifest",
  "index",
  "platform",
];
