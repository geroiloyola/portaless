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
import type { AgentAccessPolicyStore } from "./agent-access-store";

export const CONTENT_POLICY_WELL_KNOWN_PATH = "/.well-known/portaless-content-policy.json";

export interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>;
}

const VALID_ACCESS = new Set(["allow", "charge", "block"]);

export function hasCompleteRules(manifest: ContentPolicyManifest): boolean {
  const policies = manifest.policies as Record<string, { access?: unknown } | undefined>;
  return ["search", "ai_input", "ai_train"].every((k) => VALID_ACCESS.has(policies?.[k]?.access as string));
}

/** De donde sale la politica efectiva. El panel muestra esto para que el dueno sepa si edito el archivo, el panel, o nada. */
export type PolicySource = "store" | "asset" | "default";

export interface ResolvedContentPolicy {
  policy: ContentPolicyManifest;
  source: PolicySource;
  /** Presente solo si source = "store". */
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Precedencia store > asset > default (ROADMAP.md, fase 12 §12.1).
 *
 * El store es el override que el dueno escribio desde /admin/agents; el asset
 * es /.well-known/portaless-content-policy.json; el default es
 * defaultContentPolicy(). Cada capa cae a la siguiente si no existe o es
 * invalida -- nunca se aplica una politica a medias.
 *
 * Un fallo del store NO es un fallo del request: si la tabla no existe todavia
 * (instalacion vieja) o la consulta falla, se avisa y se sigue con el asset,
 * que es el comportamiento de antes de esta fase.
 *
 * El store se consulta en cada peticion de agente a proposito y SIN cache: un
 * "block" guardado desde el panel tiene que aplicar en la peticion siguiente, no
 * en la siguiente ventana de TTL. Un retardo de enforcement es un fallo de
 * privacidad, no una optimizacion.
 */
export async function resolveContentPolicy(
  origin: string,
  assets?: AssetsFetcher,
  store?: AgentAccessPolicyStore
): Promise<ResolvedContentPolicy> {
  if (store) {
    try {
      const record = await store.read();
      if (record) {
        return { policy: record.policy, source: "store", updatedAt: record.updatedAt, updatedBy: record.updatedBy };
      }
    } catch (err) {
      console.warn(`[Portaless Trust Layer] No se pudo leer el override de politica: ${(err as Error).message}. Se usa el asset.`);
    }
  }

  if (!assets || typeof assets.fetch !== "function") {
    return { policy: defaultContentPolicy(origin), source: "default" };
  }
  try {
    const res = await assets.fetch(new Request(`${origin}${CONTENT_POLICY_WELL_KNOWN_PATH}`));
    if (!res.ok) return { policy: defaultContentPolicy(origin), source: "default" };
    const json: unknown = await res.json();
    if (validateContentPolicy(json) && hasCompleteRules(json)) return { policy: json, source: "asset" };
    console.warn("[Portaless Trust Layer] portaless-content-policy.json incompleto o invalido: se usa la politica por defecto.");
  } catch (err) {
    console.warn(`[Portaless Trust Layer] No se pudo leer la politica: ${(err as Error).message}. Se usa la politica por defecto.`);
  }
  return { policy: defaultContentPolicy(origin), source: "default" };
}

/** Solo la politica efectiva, sin el origen. Se mantiene para los llamadores que no lo necesitan. */
export async function loadContentPolicy(
  origin: string,
  assets?: AssetsFetcher,
  store?: AgentAccessPolicyStore
): Promise<ContentPolicyManifest> {
  return (await resolveContentPolicy(origin, assets, store)).policy;
}
