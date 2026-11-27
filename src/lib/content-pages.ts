// Paginas de contenido multilocale (i18n, docs/i18n-design.md).
//
// Cada pagina de src/content/pages/ es un PageLayout. El idioma se deriva del
// NOMBRE DEL ARCHIVO, no de un campo obligatorio:
//   - `<slug>.json`            -> version PRIMARIA (vive en /paginas/<slug>/)
//   - `<slug>.<locale>.json`   -> TRADUCCION   (vive en /<locale>/paginas/<slug>/)
// El campo opcional `layout.locale` puede declarar el idioma de la primaria
// (si falta, se usa SITE_LANG). El motor NO usa el locale para renderizar; solo
// lo leen el <html lang>, el selector de idioma y el aviso.
//
// La regla de URL es por pagina: la version primaria va SIN prefijo y las
// traducciones bajo su prefijo de locale. Asi una pagina cuya primaria es
// espanol expone su ingles en /en/... y viceversa -- el idioma "de casa" de
// cada pagina es el de su archivo primario, no una constante global.
import type { PageLayout } from "@portaless/visual-elements/types";
import { isLocale, type Locale } from "./i18n";
import { contentPageHref as routeHref } from "./routes";
import { SITE_LANG } from "./site-lang";
import { isPubliclyPublishable } from "@portaless/deploy-engine/draft-filter";

/** Idioma por defecto de una pagina de contenido sin declararlo (el del sitio). */
export const CONTENT_PRIMARY_LOCALE: Locale = isLocale(SITE_LANG) ? SITE_LANG : DEFAULT_LOCALE;

export interface PageVersion {
  slug: string;
  locale: Locale;
  /** true = version primaria (ruta sin prefijo de locale). */
  primary: boolean;
  layout: PageLayout;
}

export interface ContentPage {
  slug: string;
  primary: PageVersion;
  /** Todas las versiones (primaria + traducciones), ordenadas por locale. */
  versions: PageVersion[];
}

/** Deriva slug + locale-del-archivo desde la ruta de un JSON de pagina. */
export function parsePagePath(path: string): { slug: string; fileLocale?: Locale } {
  const file = path.split("/").pop() ?? path;
  const base = file.replace(/\.json$/, "");
  const parts = base.split(".");
  const last = parts[parts.length - 1];
  if (parts.length > 1 && isLocale(last)) {
    return { slug: parts.slice(0, -1).join("."), fileLocale: last };
  }
  return { slug: base };
}

/**
 * Agrupa los modulos (ruta -> { default: PageLayout }) por slug. La version
 * primaria es el archivo SIN sufijo de locale; una traduccion sin primaria no
 * se publica (no tendria a que ruta pertenecer).
 */
export function groupContentPages(
  modules: Record<string, { default: PageLayout }>,
): ContentPage[] {
  const bySlug = new Map<string, { primary?: PageVersion; translations: PageVersion[] }>();
  for (const [path, mod] of Object.entries(modules)) {
    const layout = mod.default;
    const { slug, fileLocale } = parsePagePath(path);
    const locale = (isLocale(layout.locale) ? layout.locale : fileLocale) ?? CONTENT_PRIMARY_LOCALE;
    const version: PageVersion = { slug, locale, primary: !fileLocale, layout };
    const entry = bySlug.get(slug) ?? { translations: [] };
    if (version.primary) entry.primary = version;
    else entry.translations.push(version);
    bySlug.set(slug, entry);
  }

  const out: ContentPage[] = [];
  for (const [slug, entry] of bySlug) {
    if (!entry.primary) continue;
    const versions = [entry.primary, ...entry.translations].sort((a, b) =>
      a.locale.localeCompare(b.locale),
    );
    out.push({ slug, primary: entry.primary, versions });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Proyeccion publica: page primaria publica y solo versiones publicas. */
export function filterPublicContentPages(pages: ContentPage[]): ContentPage[] {
  return pages
    .filter((page) => isPubliclyPublishable(page.primary.layout))
    .map((page) => ({
      ...page,
      versions: page.versions.filter((version) => isPubliclyPublishable(version.layout)),
    }));
}

/**
 * Ruta base-relativa de una version (la primaria sin prefijo, la traduccion con
 * el suyo). Se llama `versionHref` a proposito: el modulo unico de rutas
 * (src/lib/routes.ts) ya exporta un `contentPageHref(slug, locale, base)` con
 * OTRA firma. Tener dos funciones con el mismo nombre y distinta firma fue el
 * bug que mando las tarjetas de Explore a /pages// -- no se repite.
 */
export function versionHref(version: PageVersion, base = "/"): string {
  return routeHref(version.slug, version.primary ? undefined : version.locale, base);
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSiteProfileConfig, resolveSiteProfile, type SiteProfileId } from "./site-profile.mjs";

/** Carga el layout de home del perfil activo (en o es solo en demo). */
export function loadHomeLayout(
  profile: SiteProfileId = resolveSiteProfile(),
  locale: "en" | "es" = "en",
): PageLayout {
  const config = getSiteProfileConfig(profile);
  const relPath = locale === "es" ? config.homeEsFile : config.homeFile;
  if (!relPath) {
    throw new Error(`Missing home layout for profile="${profile}" locale="${locale}".`);
  }
  const absPath = resolve(process.cwd(), relPath);
  return JSON.parse(readFileSync(absPath, "utf8")) as PageLayout;
}

/** Carga todas las paginas de contenido del perfil activo. */
export function loadContentPages(
  profile: SiteProfileId = resolveSiteProfile(),
): ContentPage[] {
  const config = getSiteProfileConfig(profile);
  const pagesRoot = resolve(process.cwd(), config.pagesDir);
  if (!existsSync(pagesRoot)) return [];
  const modules: Record<string, { default: PageLayout }> = {};
  for (const entry of readdirSync(pagesRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const layout = JSON.parse(readFileSync(join(pagesRoot, entry.name), "utf8")) as PageLayout;
    modules[`/${config.pagesDir}/${entry.name}`] = { default: layout };
  }
  return filterPublicContentPages(groupContentPages(modules));
}
