// Adaptador para Cloudflare Workers for Platforms (dispatch namespaces) /
// Dynamic Worker Loader. Cada plugin se ejecuta en su propio V8 isolate,
// con limites de CPU/memoria administrados por Cloudflare y acceso de red
// controlado via "globalOutbound" -- ver referencia oficial en
// developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/.
//
// Este NO es el unico adaptador soportado -- ver deno-deploy.ts,
// fastly-compute.ts y node-isolated-vm.ts para alternativas equivalentes
// en otros proveedores o en despliegues self-hosted.

import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

export interface CloudflareAdapterConfig {
  accountId: string;
  dispatchNamespace: string;
  apiToken: string;
}

export class CloudflareWorkersForPlatformsAdapter implements SandboxAdapter {
  readonly providerName = "cloudflare-workers-for-platforms";
  readonly supportsWasm = true;

  constructor(private config: CloudflareAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    // TODO: verificar credenciales reales contra la API de Cloudflare antes
    // de asumir disponibilidad. Placeholder de MVP: valida solo que la
    // configuracion minima este presente.
    return Boolean(this.config.accountId && this.config.dispatchNamespace && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];

    // TODO(integracion real -- v0.0.9 deja esto documentado, NO
    // implementado; ver decision explicita del roadmap, item 2). Pasos
    // concretos para cuando se aborde:
    //
    // 1. Subir el script del plugin al dispatch namespace:
    //    PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/dispatch/namespaces/{dispatchNamespace}/scripts/{scriptName}
    //    Body: multipart/form-data con `input.code` como el modulo
    //    principal (metadata.main_module) y un `metadata` JSON que declare
    //    `main_module` + `compatibility_date`. Doc:
    //    https://developers.cloudflare.com/api/operations/worker-namespace-uploads-a-worker-module
    //    Header: `Authorization: Bearer ${this.config.apiToken}`.
    //    `scriptName` debe ser deterministico por plugin (p.ej. hash del
    //    manifest.id + version) para poder reusar/actualizar en vez de
    //    acumular scripts huerfanos en el namespace.
    //
    // 2. Mapear `input.manifest.requestedCapabilities` de tipo
    //    "network:fetch" a un binding `globalOutbound` -- Workers for
    //    Platforms permite interceptar TODO el trafico saliente del
    //    worker dinamico a traves de un "outbound worker" configurado a
    //    nivel de namespace (no por script individual), que recibe la
    //    Request y decide si dejarla pasar. Esto significa que el
    //    allowlist de hosts de Portaless (igual que
    //    node-isolated-vm.ts) debe vivir en ESE outbound worker, no en el
    //    plugin subido -- requiere desplegar y mantener un segundo worker
    //    fijo por dispatch namespace. Doc:
    //    https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/
    //
    // 3. Invocar el script subido via un fetch a un Worker "dispatcher"
    //    fijo que use `env.DISPATCH_NAMESPACE.get(scriptName)` y le
    //    reenvie la request -- Cloudflare no expone un endpoint HTTP
    //    publico directo por-script dentro de un dispatch namespace, la
    //    invocacion siempre pasa por el binding de Workers del
    //    dispatcher. Ese dispatcher fijo tambien deberia ser el punto
    //    donde se inyectan `input.hostBridge` equivalentes (KV/D1/Service
    //    bindings) para las 9 capacidades no-red (storage, email,
    //    commerce, media, agent:identify, site:admin) -- no hay un
    //    mecanismo generico de "host callback" como `ivm.Reference` aqui;
    //    cada capacidad necesitaria su propio Binding configurado de
    //    antemano en el Worker dispatcher.
    //
    // 4. Limites: CPU wall-time y memoria se configuran via
    //    `usage_model`/`limits.cpu_ms` en el mismo PUT de (1) -- mapear
    //    `input.manifest.limits` (si existe) a esos campos.
    //
    // 5. Errores/timeouts: la respuesta del fetch al dispatcher debe
    //    diferenciar 5xx de Cloudflare (namespace no encontrado, script
    //    invalido) de errores lanzados POR el propio plugin -- Cloudflare
    //    no devuelve esto estructurado, hay que definir una convencion de
    //    respuesta JSON en el propio codigo bootstrap que se antepone a
    //    `input.code` antes de subirlo (similar al patron
    //    `wrappedCode`/`__portalessResultPromise` de node-isolated-vm.ts).
    //
    // Sin (1)-(5) implementado, este adaptador NO debe reportarse como
    // disponible en produccion aunque `isAvailable()` devuelva true --
    // `isAvailable()` solo valida que haya credenciales configuradas, no
    // que la integracion este completa.
    return {
      success: false,
      error: "Integración con Cloudflare Workers for Platforms pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
