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
// functions/pages/[slug].js (runtime), ambos via themeStyleDecl().

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export type ThemeVars = Record<string, string>;

export interface ThemePack {
  /** Nombre-slug unico en el catalogo: "2pac-dark". */
  name: string;
  /** Nombre humano para list_themes / UI. */
  displayName: string;
  description?: string;
  /** Otro pack del catalogo cuyas vars hereda (fusion: padre abajo). */
  extends?: string;
  /** Variables CSS permitidas -> valor seguro. Solo esto se emite. */
  vars: ThemeVars;
  /** Opcional: overrides de paleta/tokens para modo claro (fusionados sobre vars). */
  lightVars?: Partial<ThemeVars>;
  /** Opcional: overrides de paleta/tokens para modo oscuro (fusionados sobre vars). */
  darkVars?: Partial<ThemeVars>;
}

/** Formato de nombre de pack (y de "extends"): slug simple y predecible. */
export const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Allowlist base de variables -- en PARIDAD EXACTA con Object.values(TOKEN_TO_CSS_VAR)
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

/**
 * Tokens editoriales opcionales (ThemePack v2): tipografia, ritmo de
 * secciones y elevacion. Se validan con mascaras estrictas anti-inyeccion CSS.
 */
export const OPTIONAL_THEME_VARS: readonly string[] = [
  "--font-display",
  "--font-sans",
  "--space-section",
  "--elevation",
];

/** Union determinista de THEME_VARS + OPTIONAL_THEME_VARS. */
export const ALL_THEME_VARS: readonly string[] = [
  ...THEME_VARS,
  ...OPTIONAL_THEME_VARS,
];

const THEME_VAR_SET = new Set(THEME_VARS);
const OPTIONAL_THEME_VAR_SET = new Set(OPTIONAL_THEME_VARS);

/**
 * Mascara de valor para las 16 variables base, identica a la de dashboard
 * (SAFE_TOKEN_VALUE). Paridad de comportamiento fijada por test con isSafeTokenValue.
 */
const SAFE_THEME_VALUE = /^[\w#(),.%\s/-]{1,40}$/;

export function isSafeThemeValue(value: unknown): value is string {
  return typeof value === "string" && SAFE_THEME_VALUE.test(value);
}

/** Patron de rechazo explicito anti-inyeccion CSS para tokens editoriales. */
const FORBIDDEN_CSS_INJECTION = /[;{}<>\\]|url\s*\(|expression\s*\(|@import|javascript:|\/\*|\*\//i;
const SAFE_FONT_VALUE = /^[a-zA-Z0-9\s,'"-]{1,120}$/;
const SAFE_SPACE_VALUE = /^(?:0|[0-9]{1,3}(?:\.[0-9]{1,2})?(?:px|rem|em|vh|vw))$/;
const SAFE_ELEVATION_VALUE = /^(?:none|(?:(?:inset\s+)?(?:-?[0-9]{1,3}(?:\.[0-9]{1,2})?(?:px|rem)?\s+){2,4}(?:rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|#[0-9a-fA-F]{3,8})(?:\s*,\s*)?)+)$/;

/**
 * Valida un valor para cualquiera de los 4 OPTIONAL_THEME_VARS.
 * Rechaza url(), expression(), ;, {, }, <, >, @import y comentarios CSS.
 */
export function isSafeEditorialThemeValue(key: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  if (FORBIDDEN_CSS_INJECTION.test(trimmed)) return false;
  if (key === "--font-display" || key === "--font-sans") return SAFE_FONT_VALUE.test(trimmed);
  if (key === "--space-section") return SAFE_SPACE_VALUE.test(trimmed);
  if (key === "--elevation") return SAFE_ELEVATION_VALUE.test(trimmed);
  return false;
}

// --- WCAG 2.1 contrast helper (pure, no IO) -------------------------------

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

function parseHexRgb(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null;
  const trimmed = hex.trim();
  let m = HEX6.exec(trimmed);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = HEX3.exec(trimmed);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function wcagContrastRatio(fgHex: string, bgHex: string): number | null {
  const fg = parseHexRgb(fgHex);
  const bg = parseHexRgb(bgHex);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const WCAG_AA_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ["--text", "--bg", "texto sobre fondo"],
  ["--text", "--panel-bg", "texto sobre panel"],
  ["--accent-text", "--bg", "accent-text sobre fondo"],
  ["--accent-text", "--panel-bg", "accent-text sobre panel"],
  ["--muted", "--bg", "muted sobre fondo"],
  ["--success-fg", "--success-bg", "chip success"],
  ["--warning-fg", "--warning-bg", "chip warning"],
  ["--danger-fg", "--danger-bg", "chip danger"],
];

function validateVarMap(
  rawMap: unknown,
  fieldLabel: string,
  errors: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (rawMap === null || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    errors.push(`"${fieldLabel}" debe ser un objeto de variables CSS permitidas.`);
    return out;
  }
  for (const [key, value] of Object.entries(rawMap as Record<string, unknown>)) {
    if (THEME_VAR_SET.has(key)) {
      if (!isSafeThemeValue(value)) {
        errors.push(`Valor inseguro o demasiado largo para "${fieldLabel}.${key}".`);
        continue;
      }
      out[key] = value;
    } else if (OPTIONAL_THEME_VAR_SET.has(key)) {
      if (!isSafeEditorialThemeValue(key, value)) {
        errors.push(`Valor editorial inseguro o invalido para "${fieldLabel}.${key}".`);
        continue;
      }
      out[key] = (value as string).trim();
    } else {
      errors.push(`"${key}" no es una variable permitida (allowlist THEME_VARS / OPTIONAL_THEME_VARS).`);
    }
  }
  return out;
}

function validateModeContrast(
  effectiveVars: Record<string, string>,
  modeLabel: "lightVars" | "darkVars",
  errors: string[],
): void {
  for (const [fgKey, bgKey, label] of WCAG_AA_PAIRS) {
    const fg = effectiveVars[fgKey];
    const bg = effectiveVars[bgKey];
    if (!fg || !bg) continue;
    const ratio = wcagContrastRatio(fg, bg);
    if (ratio !== null && ratio < 4.5) {
      errors.push(
        `Contraste WCAG AA insuficiente en ${modeLabel} (${label}: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1, minimo 4.5:1).`,
      );
    }
  }
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

  let vars: Record<string, string> = {};
  if (raw.vars === undefined) {
    errors.push('"vars" debe ser un objeto de variables CSS permitidas.');
  } else {
    vars = validateVarMap(raw.vars, "vars", errors);
  }

  let lightVars: Record<string, string> | undefined;
  if (raw.lightVars !== undefined) {
    lightVars = validateVarMap(raw.lightVars, "lightVars", errors);
  }

  let darkVars: Record<string, string> | undefined;
  if (raw.darkVars !== undefined) {
    darkVars = validateVarMap(raw.darkVars, "darkVars", errors);
  }

  if (errors.length === 0) {
    if (lightVars) validateModeContrast({ ...vars, ...lightVars }, "lightVars", errors);
    if (darkVars) validateModeContrast({ ...vars, ...darkVars }, "darkVars", errors);
  }

  if (errors.length > 0) return { valid: false, errors };

  const pack: ThemePack = {
    name: raw.name as string,
    displayName: raw.displayName as string,
    vars,
  };
  if (typeof raw.description === "string") pack.description = raw.description;
  if (typeof raw.extends === "string") pack.extends = raw.extends;
  if (lightVars && Object.keys(lightVars).length > 0) pack.lightVars = lightVars;
  if (darkVars && Object.keys(darkVars).length > 0) pack.darkVars = darkVars;
  return { valid: true, errors: [], pack };
}

// ---------------------------------------------------------------------------
// Resolucion
// ---------------------------------------------------------------------------

export interface ResolvedTheme {
  /** El nombre pedido (la hoja de la cadena). */
  name: string;
  /** Vars fusionadas: la raiz primero, el pack pedido encima. */
  vars: ThemeVars;
  /** Overrides de modo claro fusionados a lo largo de extends (si existen). */
  lightVars?: ThemeVars;
  /** Overrides de modo oscuro fusionados a lo largo de extends (si existen). */
  darkVars?: ThemeVars;
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
  const vars: ThemeVars = {};
  const lightVars: ThemeVars = {};
  const darkVars: ThemeVars = {};
  for (const pack of chain) {
    Object.assign(vars, pack.vars);
    if (pack.lightVars) {
      for (const [k, v] of Object.entries(pack.lightVars)) {
        if (v !== undefined) lightVars[k] = v;
      }
    }
    if (pack.darkVars) {
      for (const [k, v] of Object.entries(pack.darkVars)) {
        if (v !== undefined) darkVars[k] = v;
      }
    }
  }
  const resolved: ResolvedTheme = { name, vars };
  if (Object.keys(lightVars).length > 0) resolved.lightVars = lightVars;
  if (Object.keys(darkVars).length > 0) resolved.darkVars = darkVars;
  return resolved;
}

function serializeVars(vars: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const cssVar of ALL_THEME_VARS) {
    const value = vars[cssVar];
    if (value !== undefined) parts.push(`${cssVar}:${value}`);
  }
  return parts.join(";");
}

/**
 * Declaracion CSS del tema en orden estable (THEME_VARS + OPTIONAL_THEME_VARS).
 * El emisor la pega como atributo style en <html> para temas de modo unico.
 * Los valores ya pasaron la mascara de validateThemePack: incrustarlos
 * sin escapar es seguro. Devuelve "" si el pack no declara nada.
 */
export function themeStyleDecl(theme: ResolvedTheme): string {
  return serializeVars(theme.vars);
}

/**
 * Declaracion CSS efectiva para un modo especifico ("light" | "dark")
 * fusionando vars base + lightVars/darkVars. Util para atributos
 * data-theme-light / data-theme-dark sin <style> inline ni JS inline.
 */
export function themeStyleDeclForMode(theme: ResolvedTheme, mode: "light" | "dark"): string {
  const overrides = mode === "dark" ? theme.darkVars : theme.lightVars;
  return serializeVars({ ...theme.vars, ...(overrides ?? {}) });
}

/** Devuelve true si el tema resuelto declara variantes claro/oscuro. */
export function hasDualMode(theme: ResolvedTheme): boolean {
  return Boolean(
    (theme.lightVars && Object.keys(theme.lightVars).length > 0) ||
    (theme.darkVars && Object.keys(theme.darkVars).length > 0),
  );
}

/**
 * Genera una hoja CSS scoped a :root[data-theme-pack="<name>"] para temas
 * duales (lightVars / darkVars). Especificidad (0,3,0) en [data-theme="light"]
 * y [data-theme="dark"] garantiza que el toggle del visitante funcione siempre
 * sin usar !important ni <script> inline (CSP estricto A-07 intacto).
 * Devuelve "" si el tema no es dual (en cuyo caso se usa themeStyleDecl).
 */
export function themeStyleSheet(theme: ResolvedTheme): string {
  if (!hasDualMode(theme) || !THEME_NAME_PATTERN.test(theme.name)) return "";
  const sel = `:root[data-theme-pack="${theme.name}"]`;
  const lightEffective = { ...theme.vars, ...(theme.lightVars ?? {}) };
  const darkEffective = { ...theme.vars, ...(theme.darkVars ?? {}) };
  const lightDecl = serializeVars(lightEffective);
  const darkDecl = serializeVars(darkEffective);
  const rules: string[] = [];
  if (lightDecl) rules.push(`${sel}{${lightDecl}}`);
  if (darkDecl) {
    rules.push(`@media (prefers-color-scheme:dark){${sel}:not([data-theme="light"]){${darkDecl}}}`);
    rules.push(`${sel}[data-theme="dark"]{${darkDecl}}`);
  }
  if (lightDecl) rules.push(`${sel}[data-theme="light"]{${lightDecl}}`);
  return rules.join("\n");
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
    name: "portaless-nocturno",
    displayName: "Portaless Nocturno",
    description:
      "Tema oscuro del ecosistema Portaless (default de la guia de diseno): tinta muy profunda y el lima oficial como acento. Lo usan el home, el blog y Explore; el admin puede cambiarlo por pagina.",
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
  {
    name: "portaless-editorial",
    displayName: "Portaless Editorial (Claro / Oscuro)",
    description:
      "Tema editorial dual-mode con tokens tipograficos, ritmo de secciones y elevacion. Respeta el alternador Claro/Oscuro del visitante y cumple WCAG AA en ambos modos.",
    vars: {
      "--radius": "12px",
      "--font-display": "'Fraunces Variable', Georgia, serif",
      "--font-sans": "'Inter Variable', system-ui, sans-serif",
      "--space-section": "2.5rem",
    },
    lightVars: {
      "--bg": "#FAF9F5",
      "--panel-bg": "#FFFFFF",
      "--panel-border": "#D6D3CD",
      "--text": "#1C1917",
      "--muted": "#57534E",
      "--accent": "#0369A1",
      "--accent-text": "#0369A1",
      "--accent-2": "#B45309",
      "--elevation": "0 8px 24px -16px rgba(15, 23, 42, 0.14)",
      "--success-bg": "#ECFDF5",
      "--success-fg": "#065F46",
      "--warning-bg": "#FFFBEB",
      "--warning-fg": "#92400E",
      "--danger-bg": "#FEF2F2",
      "--danger-fg": "#991B1B",
    },
    darkVars: {
      "--bg": "#0B0F17",
      "--panel-bg": "#131A26",
      "--panel-border": "#263247",
      "--text": "#F3F6FC",
      "--muted": "#A8B5CC",
      "--accent": "#38BDF8",
      "--accent-text": "#7DD3FC",
      "--accent-2": "#F59E0B",
      "--elevation": "0 8px 24px -16px rgba(0, 0, 0, 0.65)",
      "--success-bg": "#112822",
      "--success-fg": "#6EE7B7",
      "--warning-bg": "#2C2010",
      "--warning-fg": "#FCD34D",
      "--danger-bg": "#2E151B",
      "--danger-fg": "#FDA4AF",
    },
  },
];
