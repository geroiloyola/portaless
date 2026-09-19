// Contratos de tipos compartidos por todo el modulo de dashboard.
// Estos tipos son la especificacion formal del formato de skin descrito en
// Portaless_Skin_System.md.
//
// v0.0.9.25: DesignTokens agrega 6 campos de estado semantico (successBg/
// successFg, warningBg/warningFg, dangerBg/dangerFg) -- antes de este
// cambio, organisms/registry.ts hardcodeaba 2 paletas hex distintas para
// el mismo concepto bueno/medio/malo, sin ningun token configurable via
// skin.json como ya existia para accent/bg/text. Todos opcionales, igual
// que el resto de la interfaz -- un skin.json existente que no los declare
// sigue funcionando exactamente igual (fallback a DEFAULT_TOKENS via
// mergeTokens en loader.ts).

export type AccessMode = "allow" | "charge" | "block";

export interface DesignTokens {
  accent?: string;
  accent2?: string;
  radius?: string;
  density?: "compact" | "comfortable" | "spacious";
  bg?: string;
  panelBg?: string;
  panelBorder?: string;
  text?: string;
  muted?: string;
  successBg?: string;
  successFg?: string;
  warningBg?: string;
  warningFg?: string;
  dangerBg?: string;
  dangerFg?: string;
}

/**
 * Regla de posicion de un organismo dentro de la grilla del dashboard,
 * inspirada directamente en el campo "gridPos" (x, y, w, h) que usa Grafana
 * para definir sus paneles.
 */
export interface OrganismPlacement {
  organism: string;      // Debe existir en el OrganismRegistry.
  x?: number;
  y?: number;
  w?: number;            // Columnas que ocupa (sobre una grilla de N columnas).
  h?: number;            // Filas que ocupa.
  order?: number;        // Orden visual alternativo si no se usa x/y explicito.
  hidden?: boolean;      // Permite que un skin oculte un organismo del skin base.
  priority?: "low" | "normal" | "high";
}

export interface SkinManifest {
  skin: string;
  extends?: string;      // Nombre de otro skin del cual heredar (ej. "base").
  tokens?: DesignTokens;
  layout: OrganismPlacement[];
}

/** Skin ya resuelto (herencia aplicada), listo para el renderer. */
export interface ResolvedSkin {
  skin: string;
  tokens: DesignTokens;
  layout: OrganismPlacement[];
}

/** Contrato que debe cumplir cada organismo del catalogo. */
export interface OrganismDefinition<TData = unknown> {
  name: string;
  displayName: string;
  /** Renderiza el organismo a un elemento DOM ya poblado con datos. */
  render: (data: TData) => HTMLElement;
  /** Datos de ejemplo, usados si no se provee un dataProvider real. */
  mockData: TData;
}
