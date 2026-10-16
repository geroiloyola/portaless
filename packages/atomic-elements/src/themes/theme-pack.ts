// Theme packs: el look de UNA pagina (modelo linktree).
//
// Portaless tiene tres capas de theming y esta es la mas acotada:
//   1. Skin del sitio (site_skin, packages/dashboard/src/skin-engine):
//      paleta global clara/oscura de TODO el sitio, con herencia extends.
//   2. Toggle del visitante (data-theme en src/styles/global.css):
//      preferencia local que solo alterna entre esas dos paletas.
//   3. ESTA: tema por PAGINA. PageLayout.theme nombra un pack y el render
//      emite SOLO las variables que el pack declara, como atributo style
//      en <html> -- un inline que gana a cualquier regla de hoja, sin
//      !important y sin depender del orden en que global.css (cuyo bloque
//      @media oscuro tiene especificidad 0,2,0 y Astro lo inyecta despues
//      del contenido estatico del head) se cargue. Las variables que el
//      pack NO declara siguen viniendo del skin del sitio: herencia real,
//      no reemplazo total. El atributo data-theme-pack en <html> marca la
//      pagina como tematizada (tests, JS, devtools).
//
// Fronteras (mismas que element packs, ver ../elements/element-pack.ts):
//   - DATA-ONLY: un pack es JSON validado; nunca una funcion ni CSS libre.
//   - Allowlist estricta THEME_VARS: EXACTAMENTE las 16 claves que
//     TOKEN_TO_CSS_VAR mapea en dashboard (paridad fijada por test, mismo
//     patron que mcp-element-schema-parity). Un typo en el nombre seria
//     invisible (la variable nunca se aplicaria), por eso se RECHAZA al
//     validar en vez de ignorarse en silencio.
//   - Valores con la misma mascara de seguridad que isSafeTokenValue de
//     dashboard (sin ; { } < > " ' ni caracteres raros, <= 40 chars): el
//     valor se incrusta en un <style> inline sin escapar, por eso la
//     mascara es la condicion para poder hacerlo.
//   - extends fusiona vars (padre primero, el pack pedido encima) con
//     deteccion de ciclos: cadena rota o ciclica -> null, que el render
//     traduce a "sin tema" (fallback al skin del sitio). Nunca un crash
//     por la configuracion de un pack ajeno.
//
// Los packs viven en dos lugares:
//   - BUILTIN_THEMES (este archivo): siempre disponibles, tambien en el
//     build estatico sin base de datos.
//   - tabla theme_packs (../persistence/theme-pack-store.ts): instalados
//     desde fuera (marketplace -- AppPlace/AppLibre, otro repo). Un pack
//     instalado NUNCA oculta un builtin (availableThemes dedupe).
//
// Aplicacion: MCP apply_theme escribe PageLayout.theme; el emisor es
// src/layouts/BaseLayout.astro (build estatico) y
// functions/paginas/[slug].js (runtime), ambos via themeStyleDecl().

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface ThemePack {
  /** Nombre-slug unico en el catalogo: "2pac-dark". */
  name: string;
  /** Nombre humano para list_themes / UI. */
  displayName: string;
  description?: string;
  /** Otro pack del catalogo cuyas vars hereda (fusion: padre abajo). */
  extends?: string;
  /** Variables CSS permitidas -> valor seguro. Solo esto se emite. */
  vars: Record<string, string>;
}

/** Formato de nombre de pack (y de "extends"): slug simple y predecible. */
export const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Allowlist de variables -- en PARIDAD EXACTA con Object.values(TOKEN_TO_CSS_VAR)
 * de packages/dashboard/src/skin-engine/tokens.ts (fijado por test). Cada
 * entrada es ya el nombre CSS, por eso un pack no necesita mapear nada:
 * la misma lista es la que se emite y la que se valida.
 */
export const THEME_VARS: readonly string[] = [
  "--accent",
  "--accent-text",
  "--accent-2",
  "--radius",
  "--density",
  "--bg",
  "--panel-bg",
  "--panel-border",
  "--text",
  "--muted",
  "--success-bg",
  "--success-fg",
  "--warning-bg",
  "--warning-fg",
  "--danger-bg",
  "--danger-fg",
];

const THEME_VAR_SET = new Set(THEME_VARS);

/**
 * Mascara de valor, identica a la de dashboard (SAFE_TOKEN_VALUE).
 * Paridad de comportamiento fijada por test con isSafeTokenValue.
 */
const SAFE_THEME_VALUE = /^[\w#(),.%\s/-]{1,40}$/;

export function isSafeThemeValue(value: unknown): value is string {
  return typeof value === "string" && SAFE_THEME_VALUE.test(value);
}

export interface ThemeValidationResult {
  valid: boolean;
  errors: string[];
  /** Solo presente si valid === true: objeto limpio, sin claves desconocidas. */
  pack?: ThemePack;
}

/**
 * Valida un pack crudo (JSON parseado, input de un agente, fila de DB).
 * Pura, sin IO -- igual que validateElementPack y validatePageLayout.
 * Devuelve SIEMPRE un pack limpio (solo claves conocidas) cuando es valido,
 * para que el store guarde la forma canonica y no la basura recibida.
 */
export function validateThemePack(input: unknown): ThemeValidationResult {
  const errors: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["El tema debe ser un objeto."] };
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.name !== "string" || !THEME_NAME_PATTERN.test(raw.name)) {
    errors.push(`"name" debe ser un slug (minusculas, digitales y guiones): recibido ${JSON.stringify(raw.name)}.`);
  }
  if (typeof raw.displayName !== "string" || raw.displayName.trim().length === 0 || raw.displayName.length > 80) {
    errors.push('"displayName" debe ser un texto no vacio de hasta 80 caracteres.');
  }
  if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 300)) {
    errors.push('"description" debe ser un texto de hasta 300 caracteres.');
  }
  if (raw.extends !== undefined && (typeof raw.extends !== "string" || !THEME_NAME_PATTERN.test(raw.extends))) {
    errors.push(`"extends" debe nombrar un tema (slug): recibido ${JSON.stringify(raw.extends)}.`);
  }

  const vars: Record<string, string> = {};
  if (raw.vars === undefined || raw.vars === null || typeof raw.vars !== "object" || Array.isArray(raw.vars)) {
    errors.push('"vars" debe ser un objeto de variables CSS permitidas.');
  } else {
    for (const [key, value] of Object.entries(raw.vars as Record<string, unknown>)) {
      if (!THEME_VAR_SET.has(key)) {
        errors.push(`"${key}" no es una variable permitida (allowlist THEME_VARS).`);
        continue;
      }
      if (!isSafeThemeValue(value)) {
        errors.push(`Valor inseguro o demasiado largo para "${key}".`);
        continue;
      }
      vars[key] = value;
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const pack: ThemePack = {
    name: raw.name as string,
    displayName: raw.displayName as string,
    vars,
  };
  if (typeof raw.description === "string") pack.description = raw.description;
  if (typeof raw.extends === "string") pack.extends = raw.extends;
  return { valid: true, errors: [], pack };
}

// ---------------------------------------------------------------------------
// Resolucion
// ---------------------------------------------------------------------------

export interface ResolvedTheme {
  /** El nombre pedido (la hoja de la cadena). */
  name: string;
  /** Vars fusionadas: la raiz primero, el pack pedido encima. */
  vars: Record<string, string>;
}

/**
 * Resuelve un pack del catalogo siguiendo su cadena "extends".
 * Devuelve null si el nombre no existe o si la cadena esta rota (padre
 * ausente) o tiene ciclos -- el render cae al skin del sitio. Nunca lanza.
 */
export function resolveThemePack(themes: readonly ThemePack[], name: string): ResolvedTheme | null {
  const byName = new Map(themes.map((t) => [t.name, t]));
  const chain: ThemePack[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = name;
  while (cursor !== undefined) {
    if (seen.has(cursor)) return null;
    const pack = byName.get(cursor);
    if (!pack) return null;
    seen.add(cursor);
    chain.push(pack);
    cursor = pack.extends;
  }
  chain.reverse();
  const vars: Record<string, string> = {};
  for (const pack of chain) Object.assign(vars, pack.vars);
  return { name, vars };
}

/**
 * Declaracion CSS del tema en orden estable (THEME_VARS). El emisor la
 * pega como atributo style en <html> (ver la nota de cascada arriba).
 * Los valores ya pasaron la mascara de validateThemePack: incrustarlos
 * sin escapar es seguro. Devuelve "" si el pack no declara nada.
 */
export function themeStyleDecl(theme: ResolvedTheme): string {
  const parts: string[] = [];
  for (const cssVar of THEME_VARS) {
    const value = theme.vars[cssVar];
    if (value !== undefined) parts.push(`${cssVar}:${value}`);
  }
  return parts.join(";");
}

/**
 * Catalogo efectivo: builtins primero; un pack instalado con el nombre de
 * un builtin se descarta (el namespace es del sistema, el operador no
 * puede ocultar un tema que el codigo ya promete).
 */
export function availableThemes(installed: readonly ThemePack[] = []): ThemePack[] {
  const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name));
  return [...BUILTIN_THEMES, ...installed.filter((t) => !builtinNames.has(t.name))];
}

// ---------------------------------------------------------------------------
// Builtins -- viajan en el codigo, presentes en todo entorno
// ---------------------------------------------------------------------------

/**
 * Temas que estan en el repo: funcionan en build estatico sin base de
 * datos y en cualquier arranque. Los instalados (theme_packs) se suman
 * encima vía availableThemes().
 *
 * "2pac-dark": tema de ejemplo oscuro estilo linktr.ee/2Pac pedido para
 * el perfil demo. Los valores NO son una paleta nueva: son la paleta
 * oficial OSCURA (dashboard tokens.ts DEFAULT_DARK_TOKENS) con las
 * superficies desplazadas a tinta mas profunda y el acento cambiado de
 * lima al naranja oficial -- por eso los pares de texto pasan AA por
 * construccion (tests/unit/theme-pack.test.ts lo verifica por math WCAG,
 * igual que el resto del repo). El lima queda como acent-2.
 */
export const BUILTIN_THEMES: readonly ThemePack[] = [
  {
    name: "2pac-dark",
    displayName: "2Pac Dark",
    description:
      "Oscuro estilo linktr.ee/2Pac: tinta profunda de fondo y el naranja oficial de Portaless como acento. Tema de ejemplo incluido en el repo.",
    vars: {
      "--bg": "#14100C",
      "--panel-bg": "#221A12",
      "--panel-border": "#3E3226",
      "--text": "#F7F7F2",
      "--muted": "#B7AC9B",
      "--accent": "#F05D23",
      "--accent-text": "#F05D23",
      "--accent-2": "#C5D86D",
      "--success-bg": "#2A3318",
      "--success-fg": "#A8CC6B",
      "--warning-bg": "#3A2A16",
      "--warning-fg": "#E0A86B",
      "--danger-bg": "#3A1E1A",
      "--danger-fg": "#E8968C",
    },
  },
  {
    name: "home-nocturno",
    displayName: "Home Nocturno",
    description:
      "Tema oscuro del home de Portaless (docs/design/home-redesign.md): tinta muy profunda y el lima oficial como acento. Solo declara las variables permitidas; los efectos ambientales viven en global.css bajo [data-theme-pack=\"home-nocturno\"].",
    vars: {
      "--bg": "#0E0B08",
      "--panel-bg": "#171310",
      "--panel-border": "#2C231A",
      "--text": "#F7F7F2",
      "--muted": "#B7AC9B",
      "--accent": "#C5D86D",
      "--accent-text": "#C5D86D",
      "--accent-2": "#F05D23",
      "--success-bg": "#1E2A16",
      "--success-fg": "#A8CC6B",
      "--warning-bg": "#2E2410",
      "--warning-fg": "#E0B060",
      "--danger-bg": "#2E1714",
      "--danger-fg": "#E8968C",
    },
  },
];
