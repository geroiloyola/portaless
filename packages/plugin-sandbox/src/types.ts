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

/**
 * Handlers reales para las capacidades que no son "solo red" -- media,
 * email, comercio, storage propio del plugin, lectura del ledger de
 * agentes, y administracion del sitio. v0.0.9: el adaptador de
 * isolated-vm ya inyecta el puente (la funcion global dentro del isolate
 * que respeta granted/denied) para las 12 capacidades del catalogo, pero
 * 9 de esas 12 no tienen todavia un backend real en el repo (no existe
 * aun una libreria de medios, un proveedor de email transaccional, ni un
 * backend generico de storage por-plugin). Por eso cada metodo es
 * opcional: si la capacidad esta concedida pero el llamador de
 * SandboxRuntime/adapter.execute() no provee el handler correspondiente,
 * el puente devuelve un error explicito de "handler no configurado" en
 * vez de fingir exito silenciosamente o de tratarlo como denegado (que
 * seria enganoso -- la capacidad SI esta concedida, solo falta conectar
 * el backend real). Cuando un backend real exista, basta con proveer el
 * handler correspondiente aqui -- el contrato del adaptador no cambia.
 */
export interface CapabilityHostBridge {
  mediaRead?(payload: { path: string }): Promise<unknown>;
  mediaWrite?(payload: { path: string; data: unknown }): Promise<unknown>;
  emailSend?(payload: { to: string; subject: string; body: string }): Promise<unknown>;
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
  code: string;             // Codigo fuente (o modulo compilado) del plugin.
  payload: unknown;         // Datos de entrada para esta invocacion puntual.
  hostBridge?: CapabilityHostBridge; // Handlers reales opcionales, ver arriba.
  /**
   * v0.0.9.1: URL de un endpoint HTTP interno de Portaless que expone las
   * capacidades no-red (CapabilityHostBridge) para adaptadores que
   * ejecutan el codigo del plugin FUERA de este proceso Node (Cloudflare
   * Workers for Platforms, Deno Deploy) -- esos adaptadores no pueden
   * invocar hostBridge in-process como hace NodeIsolatedVmAdapter, asi
   * que necesitan un bridge sobre HTTP. Ignorado por adaptadores
   * self-hosted (node-isolated-vm.ts) que ya reciben hostBridge
   * directamente. Si se omite, esos adaptadores caen a
   * process.env.PORTALESS_CAPABILITY_BRIDGE_URL.
   */
  bridgeUrl?: string;
  /**
   * v0.0.9.26: callback opcional que emite un token efimero del
   * Capability Bridge HTTP, ANTES de construir el bootstrap que se sube
   * al proveedor edge (Deno Deploy / Cloudflare Workers for Platforms).
   * Reemplaza la generacion insegura de bridgeToken con Math.random() que
   * hacian los adaptadores -- ver hallazgo de seguridad en ROADMAP.md
   * ("Refactorizar capability-bridge.js para tokens efimeros") y el
   * store real en packages/plugin-sandbox/src/registry/stores/
   * capability-token-store.ts. Ignorado por adaptadores self-hosted
   * (node-isolated-vm.ts), que invocan hostBridge in-process y no
   * necesitan ningun token HTTP. Si un adaptador edge recibe capacidades
   * no-red concedidas pero este callback no esta presente, debe fallar
   * explicito (ver adapters/deno-deploy.ts y
   * adapters/cloudflare-workers-for-platforms.ts) en vez de generar un
   * token inseguro o silenciosamente inoperante.
   */
  issueCapabilityToken?: (pluginName: string) => Promise<{ token: string; expiresAt: string }>;
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
