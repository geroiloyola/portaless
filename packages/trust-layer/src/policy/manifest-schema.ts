// Esquema del manifiesto de politicas de contenido de un sitio Portaless.
// Publicado en "/.well-known/portaless-content-policy.json".
//
// Vocabulario de "search" / "ai_input" / "ai_train" alineado deliberadamente
// con el de Content Signals Policy de Cloudflare, para que cualquier
// crawler que ya respete ese estandar entienda la politica de Portaless
// sin aprender un formato propietario nuevo.

export type AccessMode = "allow" | "charge" | "block";

export interface PolicyRule {
  access: AccessMode;
  price_usd?: number;
  unit?: "request" | "1k_tokens_estimated";
}

export interface ContentPolicyManifest {
  version: "0.1";
  site: string;
  policies: {
    search: PolicyRule;
    ai_input: PolicyRule;
    ai_train: PolicyRule;
  };
  free_for?: string[];       // Dominios de operadores exentos de pago (ej. archivos, ONGs).
  settlement_provider?: string; // Como se liquida el cobro (ver billing/settlement-adapter.ts).
  contact?: string;
}

export function defaultContentPolicy(site: string): ContentPolicyManifest {
  return {
    version: "0.1",
    site,
    policies: {
      search: { access: "allow", price_usd: 0 },
      ai_input: { access: "charge", price_usd: 0.002, unit: "request" },
      ai_train: { access: "block" },
    },
    free_for: [],
    contact: "",
  };
}

export function validateContentPolicy(manifest: unknown): manifest is ContentPolicyManifest {
  if (typeof manifest !== "object" || manifest === null) return false;
  const m = manifest as Record<string, unknown>;
  return (
    m.version === "0.1" &&
    typeof m.site === "string" &&
    typeof m.policies === "object" &&
    m.policies !== null
  );
}
