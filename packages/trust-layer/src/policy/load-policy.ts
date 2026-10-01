// Carga en runtime la politica publicada en
// /.well-known/portaless-content-policy.json. En Cloudflare Pages el archivo
// es un asset estatico y se lee con el binding env.ASSETS.
//
// Si no hay binding (runtime Node), el archivo no existe, no es JSON o no
// tiene las tres reglas con un access valido, devuelve defaultContentPolicy()
// -- el mismo comportamiento que el middleware tenia antes de este cambio.
//
// validateContentPolicy() solo revisa version/site/policies; aca ademas se
// exige search, ai_input y ai_train con access allow|charge|block, para que
// un manifiesto a medio escribir no haga caer al middleware.

import { defaultContentPolicy, validateContentPolicy, type ContentPolicyManifest } from "./manifest-schema";

export const CONTENT_POLICY_WELL_KNOWN_PATH = "/.well-known/portaless-content-policy.json";

export interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>;
}

const VALID_ACCESS = new Set(["allow", "charge", "block"]);

export function hasCompleteRules(manifest: ContentPolicyManifest): boolean {
  const policies = manifest.policies as Record<string, { access?: unknown } | undefined>;
  return ["search", "ai_input", "ai_train"].every((k) => VALID_ACCESS.has(policies?.[k]?.access as string));
}

export async function loadContentPolicy(origin: string, assets?: AssetsFetcher): Promise<ContentPolicyManifest> {
  if (!assets || typeof assets.fetch !== "function") return defaultContentPolicy(origin);
  try {
    const res = await assets.fetch(new Request(`${origin}${CONTENT_POLICY_WELL_KNOWN_PATH}`));
    if (!res.ok) return defaultContentPolicy(origin);
    const json: unknown = await res.json();
    if (validateContentPolicy(json) && hasCompleteRules(json)) return json;
    console.warn("[Portaless Trust Layer] portaless-content-policy.json incompleto o invalido: se usa la politica por defecto.");
  } catch (err) {
    console.warn(`[Portaless Trust Layer] No se pudo leer la politica: ${(err as Error).message}. Se usa la politica por defecto.`);
  }
  return defaultContentPolicy(origin);
}
