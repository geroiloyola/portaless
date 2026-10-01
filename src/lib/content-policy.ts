// Lee el manifiesto de politicas del Trust Layer en tiempo de build.
// El archivo es opcional: packages/trust-layer/docs/TRUST_LAYER_SETUP.md pide
// copiar portaless-content-policy.example.json a portaless-content-policy.json.
// Si no existe o no es JSON valido, devuelve null y el build sigue.
//
// Se lee con fs y no con import.meta.glob porque Vite no permite importar
// archivos de public/ desde JavaScript.
//
// Usado por /llms.txt (solo necesita ai_input) y por /robots.txt (necesita el
// manifiesto completo para los Content Signals).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTENT_POLICY_PATH = "/.well-known/portaless-content-policy.json";

export interface ContentPolicySummary {
  aiInputAllowed: boolean;
}

/** Devuelve el JSON crudo del manifiesto, o null si no existe o no es JSON valido. */
export function readContentPolicyManifest(rootDir: string = process.cwd()): unknown | null {
  const file = join(rootDir, "public", ".well-known", "portaless-content-policy.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    console.warn(`[Portaless] ${file} no es JSON valido: ${(err as Error).message}. Se ignora la politica.`);
    return null;
  }
}

/** true si el manifiesto tiene version, site y las tres politicas con access. */
export function isCompleteManifest(value: unknown): boolean {
  const m = value as { version?: unknown; site?: unknown; policies?: Record<string, { access?: unknown }> } | null;
  return (
    !!m &&
    typeof m.version === "string" &&
    typeof m.site === "string" &&
    ["search", "ai_input", "ai_train"].every((k) => typeof m.policies?.[k]?.access === "string")
  );
}

export function readContentPolicy(rootDir: string = process.cwd()): ContentPolicySummary | null {
  const manifest = readContentPolicyManifest(rootDir) as { policies?: { ai_input?: { access?: string } } } | null;
  if (!manifest) return null;
  return { aiInputAllowed: manifest?.policies?.ai_input?.access !== "block" };
}
