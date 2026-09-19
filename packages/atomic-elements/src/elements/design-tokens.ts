// Tokens de color para el dashboard admin -- organismos de
// packages/atomic-elements/src/elements/registry.ts. Antes de este archivo,
// cada organismo (PolicyPanel, AgentLedgerPanel, PermissionsCenterPanel)
// hardcodeaba su propio hex por estado -- 3 semaforos bueno/medio/malo con
// paletas ligeramente distintas entre si, sin ningun punto unico de verdad.
//
// Estos tokens son variables CSS (--color-risk-*), no valores TS -- la
// intencion es que un admin pueda eventualmente personalizarlos desde un
// panel de apariencia (similar a como se elige un color de acento en un
// selector de sistema: una paleta con opciones curadas, no un input de
// texto libre), sobreescribiendo estas variables en :root sin tocar
// ningun organismo individual. Ese panel de seleccion NO se construye en
// este commit -- aqui solo se centraliza el punto donde esas variables se
// leen y se define su valor por defecto.
//
// defaultDesignTokens es el fallback si nadie configuro nada -- son los
// mismos 3 estados semanticos (bueno/medio/malo) que ya usaban PolicyPanel
// y AgentLedgerPanel antes de este cambio, elegidos como default porque ya
// eran los mas usados de los 2 sets de hex que existian.

export type RiskLevel = "bajo" | "medio" | "alto";
export type StatusTone = "success" | "warning" | "danger";

export interface DesignTokenPair {
  background: string;
  foreground: string;
}

export const CSS_VARIABLE_NAMES = {
  success: { background: "--color-success-bg", foreground: "--color-success-fg" },
  warning: { background: "--color-warning-bg", foreground: "--color-warning-fg" },
  danger: { background: "--color-danger-bg", foreground: "--color-danger-fg" },
} as const satisfies Record<StatusTone, { background: string; foreground: string }>;

/** Valores por defecto -- se aplican solo si :root no define las variables
 * CSS correspondientes (ver injectDefaultDesignTokens). Un admin que
 * configure su propia paleta sobreescribe estas variables directamente en
 * CSS, sin tocar este archivo ni recompilar. */
export const defaultDesignTokens: Record<StatusTone, DesignTokenPair> = {
  success: { background: "#eafaf0", foreground: "#1e8e3e" },
  warning: { background: "#fff4e6", foreground: "#b56d00" },
  danger: { background: "#ffecec", foreground: "#d3383f" },
};

const RISK_TO_TONE: Record<RiskLevel, StatusTone> = {
  bajo: "success",
  medio: "warning",
  alto: "danger",
};

/** Devuelve el par background/foreground como var(--...) con fallback
 * inline -- funciona sin JS adicional en el navegador (CSS resuelve el
 * fallback si la variable no esta definida en ningun ancestro) y sigue
 * funcionando si alguien renderiza el HTML fuera de un contexto con
 * injectDefaultDesignTokens ya corrido (ej. tests, SSR aislado). */
export function toneStyle(tone: StatusTone): string {
  const names = CSS_VARIABLE_NAMES[tone];
  const fallback = defaultDesignTokens[tone];
  return `background:var(${names.background}, ${fallback.background});color:var(${names.foreground}, ${fallback.foreground});`;
}

/** Mapea un RiskLevel (usado por PermissionsCenterPanel) al mismo sistema
 * de 3 tonos que ya usan PolicyPanel/AgentLedgerPanel -- unifica lo que
 * antes eran 2 paletas hex independientes en un unico set de 3 tonos
 * semanticos reutilizado por los 3 organismos. */
export function riskStyle(risk: RiskLevel): string {
  return toneStyle(RISK_TO_TONE[risk]);
}

/** Escribe las variables por defecto en :root si un admin todavia no
 * configuro una paleta propia -- usa setProperty en vez de reemplazar
 * document.documentElement.style completo, para no pisar ninguna otra
 * variable que ya exista (ej. --accent, --muted, ya usadas en
 * TrafficChartPanel/ContentListPanel). Idempotente: llamarla mas de una
 * vez no duplica ni corrompe nada. */
export function injectDefaultDesignTokens(root: HTMLElement = document.documentElement): void {
  for (const tone of Object.keys(defaultDesignTokens) as StatusTone[]) {
    const names = CSS_VARIABLE_NAMES[tone];
    const values = defaultDesignTokens[tone];
    if (!root.style.getPropertyValue(names.background)) {
      root.style.setProperty(names.background, values.background);
    }
    if (!root.style.getPropertyValue(names.foreground)) {
      root.style.setProperty(names.foreground, values.foreground);
    }
  }
}
