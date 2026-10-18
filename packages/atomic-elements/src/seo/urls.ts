// Espejo interno del modulo unico de rutas (src/lib/routes.ts, AGPL).
//
// `packages/atomic-elements` no puede importar codigo del core (misma frontera
// que `packages/plugin-sdk`); declara los segmentos de URL que emite en sus
// renders y SEO, y la EQUIVALENCIA con el modulo del core esta fijada por un
// test de paridad (tests/unit/routes-mirror-parity.test.ts). Si alguno de los
// dos cambia y no el otro, ese test falla.
export const PAGE_URL_SEGMENT = "pages";
export const SHOP_URL_SEGMENT = "shop";

/** Ruta de la tienda del sitio (la raiz, base-relativa). */
export const SHOP_PATH = `/${SHOP_URL_SEGMENT}/`;

/** URL (base-relativa) de una pagina de contenido del usuario. */
export function pageUrlPath(slug: string): string {
  return `/${PAGE_URL_SEGMENT}/${slug}`;
}
/** URL (base-relativa) de un producto de la tienda. */
export function productUrlPath(handle: string): string {
  return `/${SHOP_URL_SEGMENT}/${handle}`;
}
