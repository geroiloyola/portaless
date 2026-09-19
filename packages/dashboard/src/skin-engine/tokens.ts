// Aplica los tokens de diseno de un skin resuelto como variables CSS
// globales, para que todos los atomos (definidos con var(--accent), etc.)
// se actualicen automaticamente sin que ningun organismo necesite logica
// propia de theming.
//
// v0.0.9.25: agrega 6 tokens de estado semantico (successBg/successFg,
// warningBg/warningFg, dangerBg/dangerFg). Antes de este cambio,
// organisms/registry.ts hardcodeaba 2 paletas hex distintas para el mismo
// concepto bueno/medio/malo (una en AgentLedgerPanel/PolicyPanel, otra en
// PermissionsCenterPanel) -- sin ningun punto unico de verdad, y sin forma
// de que un admin los personalizara via skin.json como ya podia hacer con
// accent/bg/text. Los valores default elegidos abajo son los que ya usaban
// AgentLedgerPanel/PolicyPanel antes de este cambio (el set mas repetido de
// los 2 que existian).

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
  successBg: "#eafaf0",
  successFg: "#1e8e3e",
  warningBg: "#fff4e6",
  warningFg: "#b56d00",
  dangerBg: "#ffecec",
  dangerFg: "#d3383f",
};
