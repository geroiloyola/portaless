// i18n nativo, minimalista y sin dependencias (docs/i18n-design.md).
//
// Adopta el FORMATO de recursos de i18next (claves anidadas + interpolacion
// `{{var}}`, un JSON por locale) para que un traductor, un TMS o una toolchain
// de i18next puedan producir los archivos sin conversion -- pero el core los
// resuelve con este resolver puro y NO trae i18next como dependencia runtime
// (misma frontera que el plugin SDK: compatibilidad sin acoplamiento). El build
// estatico queda sin dependencias nuevas.
//
// Reglas:
//   - Locale desconocido o clave faltante: cae al DEFAULT_LOCALE, y si tampoco
//     esta, devuelve la CLAVE (nunca inventa un texto).
//   - El locale es una PROYECCION del canon (VISION): la ruta es la fuente; la
//     negociacion automatica (Accept-Language) es trabajo futuro, no de aca.

import en from "../i18n/en.json";
import es from "../i18n/es.json";

export type Locale = "en" | "es";

export const LOCALES: readonly Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";

const RESOURCES: Record<Locale, Record<string, unknown>> = {
  en: en as Record<string, unknown>,
  es: es as Record<string, unknown>,
};

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es";
}

function lookup(resource: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, resource);
}

/**
 * Resuelve una clave de UI para un locale, con interpolacion `{{var}}`.
 * Fallback: locale pedido -> locale por defecto -> la propia clave.
 */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(RESOURCES[locale], key) ?? lookup(RESOURCES[DEFAULT_LOCALE], key);
  if (typeof raw !== "string") return key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ""));
}

/**
 * Ruta de un path canonico (sin prefijo de locale) para un locale: el default
 * va sin prefijo, los demas con `/<locale>`. `/` -> `/` o `/es/`.
 */
export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}/` : `/${locale}${clean}`;
}

/** El locale "otro" para un switcher de dos idiomas. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "es" : "en";
}

/**
 * Todos los demas locales de un sitio. El switcher NO debe asumir que son dos:
 * un sitio con 3+ locales usa esta lista (hoy el header dibuja un pill por
 * locale; con 3+ el futuro es un menu, pero la condicion ya es N).
 */
export function otherLocales(locale: Locale): Locale[] {
  return LOCALES.filter((l) => l !== locale);
}

/** ¿El sitio tiene mas de un locale? Es la condicion del switcher y del aviso. */
export function isMultilingual(): boolean {
  return LOCALES.length > 1;
}

/**
 * Alternates hreflang para una ruta canonica (sin base). El caller les antepone
 * el site URL + base para volverlos absolutos (requisito de hreflang).
 */
export function hreflangAlternates(path = "/"): Array<{ hreflang: string; path: string }> {
  return LOCALES.map((locale) => ({ hreflang: locale, path: localePath(locale, path) }));
}
