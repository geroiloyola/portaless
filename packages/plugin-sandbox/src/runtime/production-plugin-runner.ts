// Caller de produccion de createSandboxRuntime() para adaptadores edge
// (v0.0.9.31). Cierra el hueco que ROADMAP.md documento como "Production
// caller of createSandboxRuntime() for edge adapters": hasta ahora el
// factory existia y estaba testeado, pero NINGUN codigo de produccion lo
// usaba -- el unico plugin en produccion (commerce-plugin via
// packages/commerce-plugin/src/host-bridge.ts) construye el adaptador
// isolated-vm a mano, que no emite tokens HTTP ni necesita bridgeUrl.
//
// Este modulo es la linea de ensamblaje completa para cualquier caller
// real (endpoint, cron, Astro endpoint):
//   1. Adaptadores edge configurados desde env -- Cloudflare Workers for
//      Platforms y Deno Deploy SOLO si sus credenciales estan presentes;
//      el adaptador self-hosted (node-isolated-vm) se agrega como ultima
//      opcion si isolated-vm esta instalado (Node), nunca en workerd.
//   2. Permisos reales del Permission Center (D1/SQLite/memoria), con la
//      regla de seguridad v0.0.9.30: granted = concedido INTERSECTADO con
//      lo que el manifiesto declara -- una capacidad concedida de mas
//      nunca llega al plugin.
//   3. Runtime via createSandboxRuntime(), asi el token store es EL MISMO
//      que valida functions/api/internal/capability-bridge.js.
//   4. bridgeUrl por-request (opcional), que los adaptadores edge leen en
//      vez del global PORTALESS_CAPABILITY_BRIDGE_URL.
//
// El codigo y el manifiesto del plugin se pasan como INPUT, no se cargan
// aqui: este modulo es runtime puro, sin dependencia de filesystem (debe
// poder bundlearse para workerd). Quien decide de donde salen los
// artefactos es el caller -- ver functions/admin/api/plugins/run.js, que
// los resuelve de disco en self-host.

import { SandboxRuntime, type PermissionResolver } from "./sandbox-runtime";
import { createSandboxRuntime } from "./sandbox-runtime-factory";
import { AdapterRegistry } from "../adapters/adapter-registry";
import { CloudflareWorkersForPlatformsAdapter } from "../adapters/cloudflare-workers-for-platforms";
import { DenoDeployAdapter } from "../adapters/deno-deploy";
import { NodeIsolatedVmAdapter } from "../adapters/node-isolated-vm";
import { createCapabilityHostBridge } from "../capabilities/capability-backends";
import type {
  PluginManifest,
  SandboxAdapter,
  SandboxExecutionResult,
  GrantedCapabilities,
  CapabilityHostBridge,
} from "../types";
import { createPermissionStore } from "../../../permissions/src/store-factory";
import type { PermissionStore } from "../../../permissions/src/permission-store";

export interface ProductionPluginRunnerEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
  /** Default de bridgeUrl si el caller no pasa uno por-request. */
  PORTALESS_CAPABILITY_BRIDGE_URL?: string;
  /** Cloudflare Workers for Platforms -- los 3 primeros son el minimo para registrar el adaptador. */
  PORTALESS_CLOUDFLARE_ACCOUNT_ID?: string;
  PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE?: string;
  PORTALESS_CLOUDFLARE_API_TOKEN?: string;
  /** URL publica del dispatcher fijo del namespace (requerido para ejecutar, no para registrar). */
  PORTALESS_CLOUDFLARE_DISPATCHER_URL?: string;
  /** Deno Deploy -- los 2 son el minimo para registrar el adaptador. */
  PORTALESS_DENO_PROJECT_ID?: string;
  PORTALESS_DENO_API_TOKEN?: string;
  /** Version de isolated-vm instalada, para el check de seguridad (GHSA-864f-rcv7-6rh4). Default: 7.0.1. */
  PORTALESS_ISOLATED_VM_VERSION?: string;
}

export interface RunPluginInProductionInput {
  manifest: PluginManifest;
  /** Codigo fuente del plugin (o modulo compilado). Resuelto por el caller. */
  code: string;
  payload: unknown;
  /**
   * URL absoluta del capability bridge HTTP de ESTE origen, para que el
   * bootstrap edge sepa donde volver. Si se omite, cae a
   * env.PORTALESS_CAPABILITY_BRIDGE_URL; si tampoco existe, los
   * adaptadores edge fallan explicito al invocar una capacidad no-red.
   */
  bridgeUrl?: string;
}

export interface RunPluginInProductionDeps {
  /** Solo para tests o wiring custom -- si se omite se construye desde env. */
  adapterRegistry?: AdapterRegistry;
  /** Solo para tests o wiring custom -- si se omite se crea desde env (D1/SQLite/memoria). */
  permissionStore?: PermissionStore;
  /**
   * Solo para tests o wiring custom -- si se omite se construye desde env con
   * `createCapabilityHostBridge()`. Es lo que le da al adaptador self-hosted
   * los backends reales (content:*, storage:*) que hasta §14.2 no recibia.
   */
  hostBridge?: CapabilityHostBridge;
}

/**
 * Construye el AdapterRegistry de produccion: primero el proveedor edge
 * preferido (Cloudflare, luego Deno -- ambos solo si sus credenciales
 * estan en env), y como ultima opcion el adaptador self-hosted
 * isolated-vm si el modulo nativo se puede importar (Node; en workerd el
 * import falla y el fallback simplemente no se registra).
 */
export async function createProductionAdapterRegistry(
  env: ProductionPluginRunnerEnv = {}
): Promise<AdapterRegistry> {
  const registry = new AdapterRegistry();

  if (env.PORTALESS_CLOUDFLARE_ACCOUNT_ID && env.PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE && env.PORTALESS_CLOUDFLARE_API_TOKEN) {
    registry.register(
      new CloudflareWorkersForPlatformsAdapter({
        accountId: env.PORTALESS_CLOUDFLARE_ACCOUNT_ID,
        dispatchNamespace: env.PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE,
        apiToken: env.PORTALESS_CLOUDFLARE_API_TOKEN,
        dispatcherUrl: env.PORTALESS_CLOUDFLARE_DISPATCHER_URL,
      })
    );
  }

  if (env.PORTALESS_DENO_PROJECT_ID && env.PORTALESS_DENO_API_TOKEN) {
    registry.register(
      new DenoDeployAdapter({
        projectId: env.PORTALESS_DENO_PROJECT_ID,
        apiToken: env.PORTALESS_DENO_API_TOKEN,
      })
    );
  }

  const nodeAdapter = await createNodeIsolatedVmAdapter(env);
  if (nodeAdapter) registry.register(nodeAdapter);

  return registry;
}

async function createNodeIsolatedVmAdapter(
  env: ProductionPluginRunnerEnv
): Promise<SandboxAdapter | null> {
  try {
    await import("isolated-vm");
  } catch {
    // No instalado (workerd, o self-host sin el paquete). Sin fallback.
    return null;
  }
  try {
    return new NodeIsolatedVmAdapter({
      installedVersion: env.PORTALESS_ISOLATED_VM_VERSION || "7.0.1",
      timeoutMs: 8000,
      poolMaxIsolates: 4,
    });
  } catch (err) {
    // Version vulnerable u otra falla de construccion (assertSafeVersion):
    // NO se registra el fallback -- mejor "ningun adaptador disponible"
    // que ejecutar con una version comprometida.
    console.warn(
      "[Portaless] Adaptador node-isolated-vm no registrado:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Ejecuta un plugin en produccion con el runtime completo: permisos
 * reales (concedido ∩ pedido), adaptador resuelto del registry edge, y
 * el mismo CapabilityTokenStore que valida el bridge HTTP.
 */
export async function runPluginInProduction(
  env: ProductionPluginRunnerEnv,
  input: RunPluginInProductionInput,
  deps: RunPluginInProductionDeps = {}
): Promise<SandboxExecutionResult> {
  const permissionStore = deps.permissionStore ?? (await createPermissionStore(env));

  // Regla de seguridad v0.0.9.30 (mismo principio que
  // packages/commerce-plugin/src/host-bridge.ts): el plugin solo puede
  // ejecutar capacidades que (a) un admin concedio en el Centro de
  // Permisos Y (b) el manifiesto declara. Concedida-de-mas se descarta
  // aqui, antes de que el adaptador vea `granted`.
  const requested = new Set<string>(
    input.manifest.requestedCapabilities.map((c) => c.id)
  );
  const resolver: PermissionResolver = {
    async getGrantedCapabilities(pluginName: string): Promise<GrantedCapabilities> {
      const grants = await permissionStore.getGrantsFor({
        type: "plugin",
        id: pluginName,
        displayName: pluginName,
      });
      const granted = grants
        .filter((g) => g.granted)
        .map((g) => g.capabilityId)
        .filter((id) => requested.has(id));
      return new Set(granted) as GrantedCapabilities;
    },
  };

  const adapterRegistry = deps.adapterRegistry ?? (await createProductionAdapterRegistry(env));
  const runtime = await createSandboxRuntime(env, adapterRegistry, resolver);

  // §14.2: los backends reales de capacidades no-red, los MISMOS que sirve el
  // capability bridge HTTP. Se pasan al adaptador self-hosted (isolated-vm) por
  // hostBridge; los adaptadores edge los alcanzan por HTTP via bridgeUrl.
  const hostBridge = deps.hostBridge ?? createCapabilityHostBridge(env);

  return runtime.runPlugin(input.manifest, input.code, input.payload, {
    bridgeUrl: input.bridgeUrl ?? env.PORTALESS_CAPABILITY_BRIDGE_URL,
    hostBridge,
  });
}
