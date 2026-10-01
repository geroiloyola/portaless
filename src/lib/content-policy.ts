// Lee el manifiesto de politicas del Trust Layer en tiempo de build.
// El archivo es opcional: packages/trust-layer/docs/TRUST_LAYER_SETUP.md pide
// copiar portaless-content-policy.example.json a portaless-content-policy.json.
// Si no existe o no es JSON valido, devuelve null y el build sigue.
//
// Se lee con fs y no con import.meta.glob porque Vite no permite importar
// archivos de public/ desde JavaScript.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTENT_POLICY_PATH = "/.well-known/portaless-content-policy.json";

export interface ContentPolicySummary {
  aiInputAllowed: boolean;
}

export function readContentPolicy(rootDir: string = process.cwd()): ContentPolicySummary | null {
  const file = join(rootDir, "public", ".well-known", "portaless-content-policy.json");
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, "utf-8"));
    return { aiInputAllowed: manifest?.policies?.ai_input?.access !== "block" };
  } catch (err) {
    console.warn(`[Portaless] ${file} no es JSON valido: ${(err as Error).message}. llms.txt se genera sin politica.`);
    return null;
  }
}
