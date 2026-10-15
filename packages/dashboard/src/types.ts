// Contratos de tipos compartidos por todo el modulo de dashboard.
//
// v0.0.9.25: DesignTokens agrega 6 campos de estado semantico (successBg/
// successFg, warningBg/warningFg, dangerBg/dangerFg) -- antes de este
// cambio, organisms/registry.ts hardcodeaba 2 paletas hex distintas para
// el mismo concepto bueno/medio/malo, sin ningun token configurable via
// skin.json como ya existia para accent/bg/text. Todos opcionales, igual
// que el resto de la interfaz -- un skin.json existente que no los declare
// sigue funcionando exactamente igual (fallback a DEFAULT_TOKENS via
// mergeTokens en loader.ts).
//
// Phase 0 (visual identity foundation): agrega accentText -- la variante
// del accent legible como texto sobre fondos claros. La paleta oficial
// (#C5D86D lima) no alcanza contraste AA como color de texto sobre
// #F7F7F2; accentText resuelve eso sin dejar de responder al accent.
//
// Fase 10 (honestidad): un skin es SOLO un conjunto de tokens con herencia
// (`extends`). Se retiro el sistema de organismos mock (layout/gridPos) que
// describe `ROADMAP.md`: nunca se renderizaba en produccion -- el dashboard
// real (`src/pages/admin/index.astro`) es HTML propio con nav cards, y los
// `skins/*.json` solo aportaban tokens via `resolveActiveSkin`. Un skin ya
// no declara `layout` ni organismos.

export type AccessMode = "allow" | "charge" | "block";

export interface DesignTokens {
  accent?: string;
  /** Variante del accent legible COMO TEXTO sobre fondos claros (evita
   *  texto puro #C5D86D sobre blanco, que no alcanza contraste AA). */
  accentText?: string;
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
 * Skin: un nombre y un conjunto de tokens, con herencia opcional via
 * `extends`. NO lleva layout ni organismos (ver Fase 10 arriba): el skin
 * solo gobierna color/tipografia (los tokens), no la estructura del panel.
 */
export interface SkinManifest {
  skin: string;
  extends?: string;      // Nombre de otro skin del cual heredar (ej. "base").
  tokens?: DesignTokens;
}

/** Skin ya resuelto (herencia de tokens aplicada), listo para el emisor CSS. */
export interface ResolvedSkin {
  skin: string;
  tokens: DesignTokens;
}
