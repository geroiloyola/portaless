// Contratos centrales del sandboxing de plugins. Deliberadamente
// independientes de cualquier proveedor especifico -- ver adapters/ para
// las implementaciones concretas (Cloudflare, Deno Deploy, Fastly, o
// isolated-vm para despliegues self-hosted sin ningun proveedor edge).

/**
 * Capacidad atomica que un plugin puede solicitar. Cada capacidad es
 * "cosa por cosa" -- exactamente el mismo principio que un permiso
 * individual de iOS/Android (camara, microfono, contactos...), aplicado a
 * lo que un plugin de Portaless puede tocar. Ver packages/permissions
 * para el catalogo completo y la UI de control granular.
 */
export type CapabilityId =
  | "content:read"
  | "content:write"
  | "media:read"
  | "media:write"
  | "network:fetch"        // Requiere ademas declarar allowedHosts.
  | "email:send"
  | "commerce:read"
  | "commerce:checkout"
  | "storage:read"
  | "storage:write"
  | "agent:identify"       // Leer info de agentes de IA verificados (Trust Layer).
  | "site:admin";          // Capacidad de alto riesgo: modificar configuracion del sitio.

export interface CapabilityRequest {
  id: CapabilityId;
  allowedHosts?: string[]; // Solo aplica a network:fetch.
  reason: string;          // Explicacion legible que el plugin debe declarar (se muestra al usuario).
}

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;                       // Ruta al codigo del plugin dentro de su paquete.
  requestedCapabilities: CapabilityRequest[];
  runtime: "javascript" | "wasm";
}

/** El subconjunto de capacidades que un administrador realmente concedio. */
export type GrantedCapabilities = Set<CapabilityId>;

export interface SandboxExecutionInput {
  manifest: PluginManifest;
  granted: GrantedCapabilities;
  code: string;             // Codigo fuente (o modulo compilado) del plugin.
  payload: unknown;         // Datos de entrada para esta invocacion puntual.
}

export interface SandboxExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  deniedCapabilityAttempts: CapabilityId[]; // Intentos de uso de capacidades NO concedidas.
  durationMs: number;
  provider: string;
}

/**
 * Contrato que debe implementar cualquier adaptador de sandboxing --
 * Cloudflare, Deno Deploy, Fastly Compute, o un runtime self-hosted como
 * isolated-vm. El motor central (runtime/sandbox-runtime.ts) nunca conoce
 * los detalles de un proveedor especifico, solo habla este contrato.
 */
export interface SandboxAdapter {
  readonly providerName: string;
  readonly supportsWasm: boolean;
  isAvailable(): Promise<boolean>;
  execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult>;
}
