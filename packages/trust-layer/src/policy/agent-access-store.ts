// packages/trust-layer/src/policy/agent-access-store.ts
//
// Override del operador sobre la politica de acceso de agentes -- ROADMAP.md
// fase 12 (la politica pasa a ser operable desde el panel, §12.1 + §12.2).
//
// Que resuelve: el middleware lee la politica publicada en
// /.well-known/portaless-content-policy.json (asset) y, si no existe, cae a
// defaultContentPolicy(). Eso obliga al dueno a editar un archivo y redesplegar
// para cambiar una regla. Esta tabla guarda el override del panel, con una
// fila unica (id = 1) porque una instancia de Portaless es single-site.
//
// Precedencia (documentada en load-policy.ts): store > asset > default.
// Esta tabla NO va en REQUIRED_TABLES: su ausencia es un estado valido -- el
// sitio sigue usando el asset.
//
// El panel expone el valor efectivo con su origen ("store" / "asset" /
// "default") para que el dueno vea de donde sale lo que aplica, en vez de
// editar un archivo y no saber si surtio efecto (ver el exit criterion de la
// fase 12 en ROADMAP.md).
//
// Validacion fail-closed: un access fuera de allow|charge|block, o un charge
// sin price, no se puede guardar. Un valor corrupto ya guardado se descarta al
// leer (queda el asset/default) con un warn, nunca se aplica a medias.

import { defaultContentPolicy, validateContentPolicy, type ContentPolicyManifest, type PolicyRule } from "./manifest-schema";

export const AGENT_ACCESS_POLICY_DDL = `CREATE TABLE IF NOT EXISTS agent_access_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
)`;

export const INVALID_AGENT_ACCESS_POLICY = "invalid_agent_access_policy";

const VALID_ACCESS = new Set(["allow", "charge", "block"]);

export interface AgentAccessPolicyRecord {
  policy: ContentPolicyManifest;
  updatedAt: string;
  updatedBy: string;
}

export interface AgentAccessPolicyStore {
  /** Override guardado, o null si el sitio usa el asset/default. */
  read(): Promise<AgentAccessPolicyRecord | null>;
  /** Valida y persiste. Lanza INVALID_AGENT_ACCESS_POLICY si es invalido. */
  write(policy: ContentPolicyManifest, updatedBy: string): Promise<AgentAccessPolicyRecord>;
  /** Vuelve al asset/default (boton "restaurar"). */
  clear(): Promise<void>;
}

/** Valida un manifiesto completo como politica de acceso de agentes. Mismo criterio que load-policy.hasCompleteRules + manifest.validate. */
export function validateAgentAccessPolicy(policy: unknown): policy is ContentPolicyManifest {
  if (!validateContentPolicy(policy)) return false;
  const p = policy as ContentPolicyManifest;
  for (const key of ["search", "ai_input", "ai_train"] as const) {
    const rule = p.policies[key] as PolicyRule;
    if (!rule || !VALID_ACCESS.has(rule.access)) return false;
    if (rule.access === "charge") {
      if (typeof rule.price_usd !== "number" || !Number.isFinite(rule.price_usd) || rule.price_usd <= 0) {
        return false;
      }
    }
    if (rule.access === "allow" && typeof rule.price_usd === "number" && rule.price_usd < 0) return false;
  }
  return true;
}

/** Serializa solo el bloque policies + metadatos publicables; descarta campos que el panel no controla. */
export function sanitizePolicy(input: ContentPolicyManifest, site: string): ContentPolicyManifest {
  const src = input.policies;
  return {
    version: "0.1",
    site,
    policies: {
      search: sanitizeRule(src.search),
      ai_input: sanitizeRule(src.ai_input),
      ai_train: sanitizeRule(src.ai_train),
    },
    free_for: Array.isArray(input.free_for) ? input.free_for.filter((d): d is string => typeof d === "string") : [],
    contact: typeof input.contact === "string" ? input.contact : "",
  };
}

function sanitizeRule(rule: PolicyRule): PolicyRule {
  const out: PolicyRule = { access: rule.access };
  if (typeof rule.price_usd === "number" && Number.isFinite(rule.price_usd)) out.price_usd = rule.price_usd;
  if (rule.unit === "request" || rule.unit === "1k_tokens_estimated") out.unit = rule.unit;
  return out;
}

export class InMemoryAgentAccessPolicyStore implements AgentAccessPolicyStore {
  private record: AgentAccessPolicyRecord | null = null;

  constructor(policy?: ContentPolicyManifest) {
    if (policy) {
      if (validateAgentAccessPolicy(policy)) {
        this.record = { policy, updatedAt: new Date().toISOString(), updatedBy: "test-seed" };
      }
    }
  }

  async read(): Promise<AgentAccessPolicyRecord | null> {
    return this.record ? { ...this.record, policy: JSON.parse(JSON.stringify(this.record.policy)) } : null;
  }

  async write(policy: ContentPolicyManifest, updatedBy: string): Promise<AgentAccessPolicyRecord> {
    if (!validateAgentAccessPolicy(policy)) throw new Error(INVALID_AGENT_ACCESS_POLICY);
    const clean = sanitizePolicy(policy, policy.site);
    this.record = { policy: clean, updatedAt: new Date().toISOString(), updatedBy };
    return { ...this.record };
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

/** Manifest por defecto con la precedencia ya resuelta (lo que ve el dueno si nunca toco nada). */
export function defaultAgentAccessPolicy(site: string): ContentPolicyManifest {
  return defaultContentPolicy(site);
}
