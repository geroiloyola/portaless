// Aplica los tokens de diseno de un skin resuelto como variables CSS
// globales, para que todos los atomos (definidos con var(--accent), etc.)
// se actualicen automaticamente sin que ningun componente necesite logica
// propia de theming.
//
// v0.0.9.25: agrega 6 tokens de estado semantico (successBg/successFg,
// warningBg/warningFg, dangerBg/dangerFg) para el mismo concepto
// bueno/medio/malo, con un punto unico de verdad y personalizables por un
// admin via skin.json (como ya lo eran accent/bg/text).
//
// Phase 0 (visual identity foundation): DEFAULT_TOKENS pasa a ser la
// PALETA OFICIAL de Portaless (lima #C5D86D / tinta #261C15 / hueso
// #F7F7F2 / salvia #E4E6C3 / naranja #F05D23) y agrega accentText, la
// variante del accent legible como texto sobre fondos claros (el lima
// puro #C5D86D no alcanza contraste AA sobre #F7F7F2). global.css
// aliasa --portaless-* a estas mismas variables, de modo que dashboard,
// editor y sitio publico comparten UN solo punto de verdad.

import type { DesignTokens } from "../types";

export const TOKEN_TO_CSS_VAR: Record<keyof DesignTokens, string> = {
  accent: "--accent",
  accentText: "--accent-text",
  accent2: "--accent-2",
  radius: "--radius",
  density: "--density",
  bg: "--bg",
  panelBg: "--panel-bg",
  panelBorder: "--panel-border",
  text: "--text",
  muted: "--muted",
  successBg: "--success-bg",
  successFg: "--success-fg",
  warningBg: "--warning-bg",
  warningFg: "--warning-fg",
  dangerBg: "--danger-bg",
  dangerFg: "--danger-fg",
};

export function applyDesignTokens(tokens: DesignTokens, root: HTMLElement = document.documentElement): void {
  for (const key of Object.keys(tokens) as (keyof DesignTokens)[]) {
    const cssVar = TOKEN_TO_CSS_VAR[key];
    const value = tokens[key];
    if (cssVar && value !== undefined) {
      root.style.setProperty(cssVar, String(value));
    }
  }
}

/** Paleta oficial de Portaless, tema CLARO (default de instalaciones nuevas). */
export const DEFAULT_TOKENS: DesignTokens = {
  accent: "#C5D86D",
  accentText: "#5A6B24",
  accent2: "#F05D23",
  radius: "22px",
  density: "comfortable",
  bg: "#F7F7F2",
  panelBg: "#FFFFFF",
  panelBorder: "#E4E6C3",
  text: "#261C15",
  muted: "#6E6653",
  successBg: "#EAF3D4",
  successFg: "#4A6B1F",
  warningBg: "#FCEBDD",
  warningFg: "#A0521B",
  dangerBg: "#FBE5E3",
  dangerFg: "#B3372C",
};

/**
 * Paleta oficial, tema OSCURO. No es el fallback de resolveSkin (que sigue
 * siendo DEFAULT_TOKENS, el claro): lo usan el bloque @media de
 * global.css y el emisor CSS de /api/site-skin para emitir la contraparte
 * oscura del skin activo.
 */
export const DEFAULT_DARK_TOKENS: DesignTokens = {
  accent: "#C5D86D",
  accentText: "#C5D86D",
  accent2: "#F05D23",
  radius: "22px",
  density: "comfortable",
  bg: "#261C15",
  panelBg: "#2F241B",
  panelBorder: "#4A3B2E",
  text: "#F7F7F2",
  muted: "#B7AC9B",
  successBg: "#2A3318",
  successFg: "#A8CC6B",
  warningBg: "#3A2A16",
  warningFg: "#E0A86B",
  dangerBg: "#3A1E1A",
  dangerFg: "#E8968C",
};
