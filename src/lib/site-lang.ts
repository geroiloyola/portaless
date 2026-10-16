// Vocabulario del sitio segun la audiencia.
//
// Regla de producto: "Blog" queda anticuada para referirse a las novedades del
// ecosistema. Cada plataforma oficial usa su propio termino y este sitio respeta
// el de su audiencia (es -> "Publicaciones", en -> "Publications").
//
// Desde la Fase 16 (docs/i18n-design.md) el vocabulario NO vive aca: la fuente
// unica es el catalogo i18n (src/i18n/<locale>.json, clave "nav.*"), y este
// modulo queda como el alias historico que el header y el shell runtime siguen
// importando. SITE_LANG sigue siendo el idioma por defecto del sitio (el resto
// del sitio todavia no esta localizado; el home si, via su propio locale).
import { t, type Locale } from "./i18n";

export type SiteLang = Locale;

export const SITE_LANG: SiteLang = "es";

/** Etiqueta para el indice de publicaciones (antes "Blog"). */
export function postsLabel(lang: SiteLang = SITE_LANG): string {
  return t(lang, "nav.posts");
}

/** Etiqueta del inicio ("Home" | "Inicio"). */
export function homeLabel(lang: SiteLang = SITE_LANG): string {
  return t(lang, "nav.home");
}

/** Etiqueta de Explore ("Explore" | "Explorar"). */
export function exploreLabel(lang: SiteLang = SITE_LANG): string {
  return t(lang, "nav.explore");
}
