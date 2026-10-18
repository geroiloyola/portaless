/**
 * @portaless/plugin-sdk — MIT-licensed public surface for third-party plugin
 * authors.
 *
 * This package RE-DECLARES the plugin authoring contract as its own document
 * (types, capability catalog and manifest validation). It does NOT import
 * `@portaless/plugin-sandbox` or any other package: the core is AGPL-3.0, and a
 * closed-source plugin that imports this SDK must never incorporate AGPL code.
 * Equivalence with the sandbox is guaranteed by a test on the AGPL side
 * (`tests/unit/plugin-sdk-parity.test.ts`), not by a runtime import.
 *
 * Licensing boundary: only the contents of this package are MIT (see LICENSE).
 * The rest of the repository is AGPL-3.0 (see ../LICENSE).
 *
 * Honest scope note (Phase 11): this is the initial 0.1.0 shape. The capability
 * surface — quotas for `storage:*`, error codes for the real backends, the HTTP
 * installer — is still being wired in the core (Phase 11.2), so treat the exact
 * set of capability fields as provisional until that phase closes.
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * `typ` del header del manifiesto firmado por el publicador (ERRATA E-15). Un
 * publisher firma su manifiesto con su `did:apw` usando este typ; el instalador
 * lo verifica contra la identidad resuelta. Deep-equal con la constante del core
 * (chequeado por `tests/unit/plugin-sdk-parity.test.ts`).
 */
export const PLUGIN_MANIFEST_TYP = "apw-plugin-manifest+jws";

/**
 * Atomic capability a plugin can request — one thing at a time, the same
 * principle as an individual iOS/Android permission. This is the shared
 * vocabulary between the plugin sandbox and the Permissions Center.
 */
export type CapabilityId =
  | "content:read"
  | "content:write"
  | "media:read"
  | "media:write"
  | "network:fetch"
  | "email:send"
  | "commerce:read"
  | "commerce:checkout"
  | "storage:read"
  | "storage:write"
  | "agent:identify"
  | "site:admin"
  | "billing:pay-per-crawl"
  | "trust:read-governance-bypass";

/** Capabilities a plugin manifest may request — excludes the two reserved ids. */
export type PluginCapabilityId = Exclude<CapabilityId, "billing:pay-per-crawl" | "trust:read-governance-bypass">;

/**
 * The capability ids a plugin may declare. `billing:pay-per-crawl` (settlement
 * providers only) and `trust:read-governance-bypass` (reader DIDs only) are not
 * plugin capabilities: they are granted outside the manifest flow.
 */
export const PLUGIN_CAPABILITY_IDS: readonly PluginCapabilityId[] = [
  "content:read",
  "content:write",
  "media:read",
  "media:write",
  "network:fetch",
  "email:send",
  "commerce:read",
  "commerce:checkout",
  "storage:read",
  "storage:write",
  "agent:identify",
  "site:admin",
];

export type CapabilityRisk = "bajo" | "medio" | "alto";

export interface CapabilityDefinition {
  id: CapabilityId;
  category: "Contenido" | "Red" | "Comercio" | "Almacenamiento" | "Agentes IA" | "Administración" | "Cobros";
  label: string;
  description: string;
  risk: CapabilityRisk;
}

/**
 * Risk levels from most to least dangerous. Deep-equal to `RISK_ORDER` in
 * `@portaless/plugin-sandbox` (checked by the parity test).
 */
export const RISK_ORDER: readonly CapabilityRisk[] = ["alto", "medio", "bajo"];

/** Human labels for each risk level. Deep-equal to the core `RISK_LABELS`. */
export const RISK_LABELS: Record<CapabilityRisk, string> = {
  alto: "Alto riesgo",
  medio: "Riesgo medio",
  bajo: "Riesgo bajo",
};

/**
 * Master catalog of atomic capabilities grouped by category. Deep-equal to
 * `capabilityRegistry` in `@portaless/plugin-sandbox` (checked by the AGPL-side
 * parity test). Exposed so a plugin author can display what a capability means.
 */
export const capabilityRegistry: Record<CapabilityId, CapabilityDefinition> = {
  "content:read": {
    id: "content:read", category: "Contenido",
    label: "Leer contenido del sitio",
    description: "Permite al plugin leer páginas, posts y metadatos existentes.",
    risk: "bajo",
  },
  "content:write": {
    id: "content:write", category: "Contenido",
    label: "Editar o crear contenido",
    description: "Permite crear o modificar páginas y posts.",
    risk: "medio",
  },
  "media:read": {
    id: "media:read", category: "Contenido",
    label: "Leer biblioteca de medios",
    description: "Permite acceder a imágenes y archivos subidos al sitio.",
    risk: "bajo",
  },
  "media:write": {
    id: "media:write", category: "Contenido",
    label: "Subir o modificar medios",
    description: "Permite agregar o reemplazar imágenes/archivos.",
    risk: "medio",
  },
  "network:fetch": {
    id: "network:fetch", category: "Red",
    label: "Conectarse a servicios externos",
    description: "Permite hacer peticiones de red, únicamente a los hosts explícitamente autorizados.",
    risk: "alto",
  },
  "email:send": {
    id: "email:send", category: "Red",
    label: "Enviar correos en nombre del sitio",
    description: "Permite disparar envíos de email transaccional.",
    risk: "medio",
  },
  "commerce:read": {
    id: "commerce:read", category: "Comercio",
    label: "Leer catálogo/pedidos",
    description: "Permite consultar productos, precios y pedidos vía Medusa/Mercur.",
    risk: "medio",
  },
  "commerce:checkout": {
    id: "commerce:checkout", category: "Comercio",
    label: "Iniciar procesos de cobro",
    description: "Permite iniciar un flujo de checkout (nunca procesa el pago directamente).",
    risk: "alto",
  },
  "storage:read": {
    id: "storage:read", category: "Almacenamiento",
    label: "Leer almacenamiento del plugin",
    description: "Acceso de lectura únicamente al espacio de almacenamiento propio del plugin.",
    risk: "bajo",
  },
  "storage:write": {
    id: "storage:write", category: "Almacenamiento",
    label: "Escribir en almacenamiento del plugin",
    description: "Acceso de escritura únicamente al espacio de almacenamiento propio del plugin.",
    risk: "medio",
  },
  "agent:identify": {
    id: "agent:identify", category: "Agentes IA",
    label: "Leer identidad de agentes verificados",
    description: "Permite consultar el ledger del Trust Layer (qué agentes de IA visitaron el sitio).",
    risk: "bajo",
  },
  "site:admin": {
    id: "site:admin", category: "Administración",
    label: "Modificar configuración del sitio",
    description: "Capacidad de más alto riesgo: cambia ajustes globales del sitio.",
    risk: "alto",
  },
  "billing:pay-per-crawl": {
    id: "billing:pay-per-crawl", category: "Cobros",
    label: "Cobrar el acceso de agentes de IA (pay per crawl)",
    description: "Un proveedor externo cobra a los crawlers por cada acceso. Portaless no toca el dinero. Requiere credenciales verificadas del proveedor.",
    risk: "alto",
  },
  "trust:read-governance-bypass": {
    id: "trust:read-governance-bypass", category: "Administración",
    label: "Excepción de lectura por lector (APW)",
    description: "Permite a un lector con DID verificado leer aunque no cumpla los umbrales de reputación de la política de lectura. No exime de Web Bot Auth ni de identidad APW.",
    risk: "alto",
  },
};

export function listCapabilitiesByCategory(): Record<string, CapabilityDefinition[]> {
  const grouped: Record<string, CapabilityDefinition[]> = {};
  for (const def of Object.values(capabilityRegistry)) {
    grouped[def.category] = grouped[def.category] ?? [];
    grouped[def.category].push(def);
  }
  return grouped;
}

/** Grouped by risk, most dangerous first. Deep-equal to the core helper. */
export function listCapabilitiesByRisk(): Record<CapabilityRisk, CapabilityDefinition[]> {
  const grouped = { alto: [], medio: [], bajo: [] } as Record<CapabilityRisk, CapabilityDefinition[]>;
  for (const def of Object.values(capabilityRegistry)) grouped[def.risk].push(def);
  return grouped;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface CapabilityRequest {
  id: CapabilityId;
  /** Only meaningful for `network:fetch`. */
  allowedHosts?: string[];
  /** Human-readable reason, shown to the operator who approves the grant. */
  reason: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  requestedCapabilities: CapabilityRequest[];
  runtime: "javascript" | "wasm";
  /**
   * Compatibilidad declarada con el core. Opcional (sin declarar = compatible).
   * `portaless` es un rango semver minimo (^, ~, >=, <=, >, <, =, `||`). El core
   * rechaza un plugin cuyo rango no incluya su version.
   */
  engines?: { portaless?: string };
}

/** The subset of capabilities an administrator actually granted. */
export type GrantedCapabilities = Set<CapabilityId>;

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ¿La version del core satisface el rango declarado en `engines.portaless`?
 * Matcher semver minimo y SIN dependencia: soporta `^`, `~`, `>=`, `<=`, `>`,
 * `<`, `=` y `||`. Un rango sin declarar (o vacio) es compatible (fallback
 * seguro); un rango con sintaxis desconocida es INCOMPATIBLE (fail-closed).
 * El core usa la misma funcion (paridad fijada por tests/unit/plugin-sdk-parity).
 */
export function isEngineCompatible(range: string | undefined, version: string): boolean {
  const r = String(range ?? "").trim();
  const v = String(version ?? "").trim();
  if (!r) return true;
  const parse = (s: string) => s.replace(/^[^0-9]*/, "").split(".").map((n) => Number(n) || 0);
  const [maj, min, pat] = parse(v);
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  for (const part of r.split("||").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return false;
    const op = m[1] ?? "=";
    const target = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
    const c = cmp([maj, min, pat], target);
    const ok =
      op === "=" ? c === 0 :
      op === ">=" ? c >= 0 :
      op === "<=" ? c <= 0 :
      op === ">" ? c > 0 :
      op === "<" ? c < 0 :
      op === "^" ? c >= 0 && maj === target[0] :
      op === "~" ? c >= 0 && maj === target[0] && min === target[1] :
      false;
    if (ok) return true;
  }
  return false;
}

/**
 * Validates a manifest before it can be registered or run. Same rules as the
 * core (`@portaless/plugin-sandbox`), verified by the parity test: an unknown
 * capability is rejected, `network:fetch` must declare hosts, every request
 * needs a reason of at least 8 characters, and `trust:read-governance-bypass`
 * is not a plugin capability.
 */
export function validateManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest.name) errors.push('Falta "name" en el manifiesto.');
  if (!manifest.entry) errors.push('Falta "entry" en el manifiesto.');

  if (manifest.engines !== undefined) {
    if (typeof manifest.engines !== "object" || manifest.engines === null) {
      errors.push('"engines" debe ser un objeto (ej. { "portaless": "^0.0.10" }).');
    } else if (manifest.engines.portaless !== undefined && (typeof manifest.engines.portaless !== "string" || !manifest.engines.portaless.trim())) {
      errors.push('"engines.portaless" debe ser un rango semver no vacio.');
    }
  }

  const requested = Array.isArray(manifest.requestedCapabilities) ? manifest.requestedCapabilities : null;
  if (!requested) {
    errors.push('Falta "requestedCapabilities" (array, puede ser vacio) en el manifiesto.');
  }

  for (const req of requested ?? []) {
    if (!capabilityRegistry[req.id as CapabilityId]) {
      errors.push(`Capacidad desconocida solicitada: "${req.id}"`);
      continue;
    }
    if (req.id === "trust:read-governance-bypass") {
      errors.push('"trust:read-governance-bypass" no es una capacidad de plugins: se concede por DID de lector en el Centro de Permisos.');
      continue;
    }
    if (req.id === "network:fetch" && (!req.allowedHosts || req.allowedHosts.length === 0)) {
      errors.push('"network:fetch" requiere declarar al menos un host en "allowedHosts".');
    }
    if (!req.reason || req.reason.trim().length < 8) {
      errors.push(`La capacidad "${req.id}" debe declarar una razón legible (mínimo 8 caracteres).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Runtime contract
// ---------------------------------------------------------------------------

/**
 * The handlers the host injects for the non-network capabilities. Every method
 * is optional: if a granted capability has no backend connected, the bridge
 * fails explicitly instead of pretending success or treating it as denied.
 */
export interface CapabilityHostBridge {
  mediaRead?(payload: { path: string }): Promise<unknown>;
  mediaWrite?(payload: { path: string; data: unknown }): Promise<unknown>;
  emailSend?(pluginName: string, payload: { template: string; to: string; data?: Record<string, unknown> }): Promise<unknown>;
  commerceRead?(payload: Record<string, unknown>): Promise<unknown>;
  commerceCheckout?(payload: Record<string, unknown>): Promise<unknown>;
  storageRead?(pluginName: string, payload: { key: string }): Promise<unknown>;
  storageWrite?(pluginName: string, payload: { key: string; value: unknown }): Promise<unknown>;
  agentIdentify?(payload: Record<string, unknown>): Promise<unknown>;
  siteAdmin?(payload: Record<string, unknown>): Promise<unknown>;
  contentRead?(payload: Record<string, unknown>): Promise<unknown>;
  contentWrite?(payload: Record<string, unknown>): Promise<unknown>;
}

export interface SandboxExecutionInput {
  manifest: PluginManifest;
  granted: GrantedCapabilities;
  code: string;
  payload: unknown;
  hostBridge?: CapabilityHostBridge;
  bridgeUrl?: string;
  issueCapabilityToken?: (pluginName: string) => Promise<{ token: string; expiresAt: string }>;
}

export interface SandboxExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  deniedCapabilityAttempts: CapabilityId[];
  durationMs: number;
  provider: string;
}

export interface SandboxAdapter {
  readonly providerName: string;
  readonly supportsWasm: boolean;
  isAvailable(): Promise<boolean>;
  execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult>;
}

// ---------------------------------------------------------------------------
// Plugin entry globals (the typed contract the sandbox injects)
// ---------------------------------------------------------------------------

/** Read-only network access, allowed only for `network:fetch` + declared hosts. */
export type PluginFetchAllowed = (url: string, opts?: unknown) => Promise<string>;

/** The `capabilities.*` handlers injected into the plugin isolate. */
export interface PluginCapabilities {
  readContent(args: unknown): Promise<unknown>;
  writeContent(args: unknown): Promise<unknown>;
  mediaRead(args: unknown): Promise<unknown>;
  mediaWrite(args: unknown): Promise<unknown>;
  emailSend(args: unknown): Promise<unknown>;
  commerceRead(args: unknown): Promise<unknown>;
  commerceCheckout(args: unknown): Promise<unknown>;
  storageRead(args: unknown): Promise<unknown>;
  storageWrite(args: unknown): Promise<unknown>;
  agentIdentify(args: unknown): Promise<unknown>;
  siteAdmin(args: unknown): Promise<unknown>;
}

export interface PluginEntryContext {
  fetchAllowed: PluginFetchAllowed;
  capabilities: PluginCapabilities;
  console: { log(...args: unknown[]): void };
}

/**
 * The shape of a plugin entry. The sandbox wraps the plugin's code with these
 * globals (`payload`, `console`, `fetchAllowed`, `capabilities`); this type is
 * the normative, importable declaration of that contract.
 */
export type PluginEntry = (payload: unknown, ctx: PluginEntryContext) => unknown | Promise<unknown>;
