import { classifySvriLevel, type SvriLevel, type SvriProjection } from "../../packages/apw-resolver/src/scoring/svri";

export type SvriPublicInput = Pick<SvriProjection, "score" | "incompleteData" | "isInference" | "t1Count" | "t2Count"> |
  { publicLevel?: SvriLevel };

export interface SvriPublicLevelView {
  id: SvriLevel;
  label: string;
  colorToken: "--success-fg" | "--accent-text" | "--warning-fg" | "--danger-fg" | "--muted";
  iconName: "shield-check" | "check" | "hourglass" | "alert" | "shield-x";
}

const LEVELS: Record<SvriLevel, SvriPublicLevelView> = {
  reliable: { id: "reliable", label: "SVRI: Confiable", colorToken: "--success-fg", iconName: "shield-check" },
  safe: { id: "safe", label: "SVRI: Seguro", colorToken: "--accent-text", iconName: "check" },
  pending: { id: "pending", label: "SVRI: Pendiente", colorToken: "--muted", iconName: "hourglass" },
  verify: { id: "verify", label: "SVRI: Verificar", colorToken: "--warning-fg", iconName: "alert" },
  low: { id: "low", label: "SVRI: Bajo", colorToken: "--danger-fg", iconName: "shield-x" },
};

const VALID_LEVELS = new Set<SvriLevel>(["reliable", "safe", "pending", "verify", "low"]);

/** Public presentation helper. Missing, malformed or incomplete data fails closed to Pendiente. */
export function getPublicSvriLevel(input: SvriPublicInput | null | undefined): SvriPublicLevelView {
  if (!input || typeof input !== "object") return LEVELS.pending;
  if ("publicLevel" in input) {
    return input.publicLevel && VALID_LEVELS.has(input.publicLevel) ? LEVELS[input.publicLevel] : LEVELS.pending;
  }
  return LEVELS[classifySvriLevel(input)];
}
