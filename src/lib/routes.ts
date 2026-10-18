// La UNICA fuente de las rutas publicas. src/, functions/ y server/ construyen
// URLs con este modulo (igual que docs-nav.mjs / site-lang: modulos puros
// importables por los tres runtimes), nunca con segmentos escritos a mano.
//
// Sistema de prefijos de idioma: DEFAULT_LOCALE es "en" (localePath en
// src/lib/i18n.ts: el ingles va SIN prefijo, el espanol bajo /es/, resto bajo
// /<locale>/). Las paginas del SISTEMA la cumplen. Las paginas de contenido del
// usuario conservan "idioma de autoria = ruta principal": el archivo
// `<slug>.json` vive en la ruta sin prefijo (su idioma propio) y las traducciones
// `<slug>.<locale>.json` bajo su prefijo (ver docs/i18n-design.md).
//
// LEGACY_ROUTES mapea las URLs previas a la refactorizacion. Es un mapa FIJO
// (sin open redirect): matching por tabla con prefijo, slug validado con
// [A-Za-z0-9-], query string preservado. Lo consumen:
//   - Astro (build estatico: paginas meta-refresh con canonical),
//   - functions/../  (301 en el punto de entrada comun de Cloudflare Pages),
//   - server/ (301 en el runtime Node self-host). Con la misma tabla.

import { LOCALES, localePath, type Locale } from "./i18n";

export const ROUTES = {
  PAGES: "/pages",
  SHOP: "/shop",
  PROJECTIONS: "/projections",
  BETA: "/beta",
  DOCS: "/docs",
  EXPLORE: "/explore",
  TRUST: "/trust",
} as const;

export type RouteName = keyof typeof ROUTES;

/**
 * URL base-relativa de una ruta canonica del SISTEMA en un locale: la canonica
 * es la ruta en el idioma por defecto (sin prefijo); los demas van bajo
 * /<locale>/ (localePath). Ej. systemHref("BETA", "es") -> "/es/beta".
 */
export function systemHref(name: RouteName, locale: Locale = "en", base = "/"): string {
  return `${base.replace(/\/+$/, "")}${localePath(locale, ROUTES[name])}`;
}

/**
 * Ruta de una pagina de contenido del usuario. Sin locale = version PRIMARIA
 * (idioma de autoria, ruta sin prefijo); con locale = una traduccion bajo su
 * prefijo, ej. contentPagePath("bio", "es") -> "/es/pages/bio/".
 */
export function contentPagePath(slug: string, locale?: Locale): string {
  // Un slug puede anidar segmentos (a/b); los segmentos de traversal se
  // descartan: "../etc" nunca produce /paginas/../etc/.
  const slugSeg = String(slug ?? "./")
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return locale ? `/${locale}${ROUTES.PAGES}/${slugSeg}/` : `${ROUTES.PAGES}/${slugSeg}/`;
}

export function contentPageHref(slug: string, locale: Locale | undefined, base = "/"): string {
  return `${base.replace(/\/+$/, "")}${contentPagePath(slug, locale)}`;
}

// ---------------------------------------------------------------------------
// URLs legadas (pre-refactorizacion) -> destino nuevo. Orden: el primer patron
// que matchea gana. El segmento de slug se valida (solo [a-zA-Z0-9._-], 1..80):
// cualquier otra forma NO se redirige (devuelve null y el host responde como
// siempre -- jamas un open redirect).
// ---------------------------------------------------------------------------
export interface LegacyRedirect {
  from: RegExp;
  /** @returns destino base-relativo, o null para no redirigir. */
  to: (m: RegExpMatchArray) => string | null;
}

/** Segmento de locale admitido en las rutas legadas: solo los del sitio. */
const LOCALE_SEGMENT = LOCALES.join("|");

const SLUG = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";

export const LEGACY_ROUTES: LegacyRedirect[] = [
  // Contenido del usuario: /paginas/:slug/ y /<locale>/paginas/:slug/
  // /en/paginas era la version ingles anterior -> la canonica (sin prefijo).
  {
    from: new RegExp(`^/(${LOCALE_SEGMENT})/paginas/(${SLUG})/?$`),
    to: (m) => {
      const locale = m[1];
      const slug = m[2];
      return locale === "en" ? `/pages/${slug}/` : `/${locale}/pages/${slug}/`;
    },
  },
  {
    from: new RegExp(`^/paginas/(${SLUG})/?$`),
    to: (m) => `/pages/${m[1]}/`,
  },
  // tienda: la raiz vieja era espanol (=> /es/shop/); un handle va a /shop/:handle/
  { from: /^\/tienda\/?$/, to: () => "/es/shop/" },
  {
    from: new RegExp(`^/tienda/(${SLUG})/?$`),
    to: (m) => `/shop/${m[1]}/`,
  },
  // /en/tienda (version ingles anterior) -> la raiz nueva (ingles sin prefijo)
  { from: /^\/en\/tienda\/?$/, to: () => "/shop/" },
  // proyecciones: la vieja raiz era espanol (=> /es/projections/); /en -> canonica
  { from: /^\/proyecciones\/?$/, to: () => "/es/projections/" },
  { from: /^\/en\/proyecciones\/?$/, to: () => "/projections/" },
  // beta: /en/beta -> canonica (/beta ahora es ingles, sin prefijo)
  { from: /^\/en\/beta\/?$/, to: () => "/beta/" },
  // docs renombrado
  { from: /^\/docs\/primos-pasos\/?$/, to: () => "/docs/first-steps/" },
  { from: /^\/docs\/primos-pasos\.md$/, to: () => "/docs/first-steps.md" },
];

/** Resuelve una URL legada a su destino nuevo. @returns null si no hay redirect. */
export function resolveLegacyRedirect(pathname: string): string | null {
  let path = String(pathname ?? "");
  let query = "";
  const q = path.indexOf("?");
  if (q >= 0) {
    query = path.slice(q);
    path = path.slice(0, q);
  }
  for (const rule of LEGACY_ROUTES) {
    const m = path.match(rule.from);
    if (!m) continue;
    const destination = rule.to(m);
    return destination ? `${destination}${query}` : null;
  }
  return null;
}
