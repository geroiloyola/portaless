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

import { openSqlite } from "../../../sqlite-driver/src/open";
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
    // charge exige un precio valido (0 no es cobrar): si el operador elige
    // charge y no pone precio, guardamos una politica que el middleware no
    // podria cobrar. Se rechaza aca en vez de dejarlo para la ejecucion.
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
function sanitizePolicy(input: ContentPolicyManifest, site: string): ContentPolicyManifest {
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

const UPSERT_SQL = `INSERT INTO agent_access_policy (id, policy_json, updated_at, updated_by)
  VALUES (1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`;

const READ_SQL = "SELECT policy_json, updated_at, updated_by FROM agent_access_policy WHERE id = 1";

/** Parsea lo guardado; si esta corrupto lo descarta (queda asset/default) y avisa. */
function recordFromRow(row: any): AgentAccessPolicyRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.policy_json);
  } catch {
    console.warn("[Portaless AgentAccess] policy_json no es JSON: se ignora el override y se usa el asset/default.");
    return null;
  }
  if (!validateAgentAccessPolicy(parsed)) {
    console.warn("[Portaless AgentAccess] override guardado invalido: se ignora y se usa el asset/default.");
    return null;
  }
  return { policy: parsed, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export class SqlAgentAccessPolicyStore implements AgentAccessPolicyStore {
  private db: any;

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqlAgentAccessPolicyStore no acepta una ruta: usa SqlAgentAccessPolicyStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(AGENT_ACCESS_POLICY_DDL);
  }

  static async open(dbPath: string): Promise<SqlAgentAccessPolicyStore> {
    return new SqlAgentAccessPolicyStore(await openSqlite(dbPath));
  }

  async read(): Promise<AgentAccessPolicyRecord | null> {
    const row = this.db.prepare(READ_SQL).get();
    return row === undefined ? null : recordFromRow(row);
  }

  async write(policy: ContentPolicyManifest, updatedBy: string): Promise<AgentAccessPolicyRecord> {
    if (!validateAgentAccessPolicy(policy)) throw new Error(INVALID_AGENT_ACCESS_POLICY);
    const updatedAt = new Date().toISOString();
    const clean = sanitizePolicy(policy, policy.site);
    this.db
      .prepare(UPSERT_SQL)
      .run(JSON.stringify(clean), updatedAt, updatedBy);
    return { policy: clean, updatedAt, updatedBy };
  }

  async clear(): Promise<void> {
    this.db.prepare("DELETE FROM agent_access_policy WHERE id = 1").run();
  }

  close(): void {
    this.db.close();
  }
}

export class InMemoryAgentAccessPolicyStore implements AgentAccessPolicyStore {
  private record: AgentAccessPolicyRecord | null = null;

  constructor(policy?: ContentPolicyManifest) {
    if (policy) {
      // seed solo si es valido; si no, arranca sin override
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

export interface AgentAccessPolicyFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

/**
 * Factory multi-backend. Sin DB ni PORTALESS_SQLITE_PATH usa memoria: el
 * override vive lo que dura el isolate, asi que el middleware vuelve al
 * asset/default -- y avisa, para que el warning no se lea como un silencio.
 */
export async function createAgentAccessPolicyStore(env: AgentAccessPolicyFactoryEnv): Promise<AgentAccessPolicyStore> {
  if (env?.DB) return new SqlAgentAccessPolicyStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) return SqlAgentAccessPolicyStore.open(env.PORTALESS_SQLITE_PATH);
  console.warn("[Portaless AgentAccess] Sin DB ni PORTALESS_SQLITE_PATH. Override de politica en memoria (se pierde al reiniciar).");
  return new InMemoryAgentAccessPolicyStore();
}

/** Manifest por defecto con la precedencia ya resuelta (lo que ve el dueno si nunca toco nada). */
export function defaultAgentAccessPolicy(site: string): ContentPolicyManifest {
  return defaultContentPolicy(site);
}
