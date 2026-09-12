// Aplica los tokens de diseno de un skin resuelto como variables CSS
// globales, para que todos los atomos (definidos con var(--accent), etc.)
// se actualicen automaticamente sin que ningun organismo necesite logica
// propia de theming.

import type { DesignTokens } from "../types";

const TOKEN_TO_CSS_VAR: Record<keyof DesignTokens, string> = {
  accent: "--accent",
  accent2: "--accent-2",
  radius: "--radius",
  density: "--density",
  bg: "--bg",
  panelBg: "--panel-bg",
  panelBorder: "--panel-border",
  text: "--text",
  muted: "--muted",
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

export const DEFAULT_TOKENS: DesignTokens = {
  accent: "#34c759",
  accent2: "#30d5c8",
  radius: "22px",
  density: "comfortable",
  bg: "#f0f1f6",
  panelBg: "#ffffff",
  panelBorder: "#eceef5",
  text: "#1b1d26",
  muted: "#8b8ea0",
};
