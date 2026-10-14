// Vocabulario del sitio segun la audiencia.
//
// Regla de producto: "Blog" queda anticuada para referirse a las
// novedades del ecosistema. Cada plataforma oficial usa su propio
// termino y este sitio respeta el de su audiencia:
//   - audiencia hispana (es) -> "Publicaciones"
//   - audiencia global   (en) -> "Posts"
// Ambas son la palabra "correcta" porque es la que las plataformas usan
// oficialmente (WordPress, Medium, LinkedIn, Instagram...).
//
// Fuente unica de verdad: SITE_LANG cambia juntos el lang del <html> y
// el label del indice de publicaciones, para que nunca queden
// desincronizados. Hoy es una constante (el sitio todavia no tiene i18n
// real); puede promoverse a un ajuste del sitio / env PUBLIC_SITE_LANG
// cuando exista negociacion de idioma.
export type SiteLang = "es" | "en";

export const SITE_LANG: SiteLang = "es";

/** Terminos canonicos por concepto y audiencia. */
const VOCABULARY: Record<SiteLang, { posts: string }> = {
  es: { posts: "Publicaciones" },
  en: { posts: "Posts" },
};

/** Etiqueta para el indice de publicaciones (antes "Blog"). */
export function postsLabel(lang: SiteLang = SITE_LANG): string {
  return VOCABULARY[lang].posts;
}
