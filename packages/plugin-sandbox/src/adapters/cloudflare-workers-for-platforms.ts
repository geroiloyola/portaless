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

    // TODO(integracion real): subir `input.code` como script al dispatch
    // namespace via la API de Cloudflare, e invocarlo con un binding de
    // "globalOutbound" restringido a los hosts declarados en
    // requestedCapabilities de tipo "network:fetch". Este MVP deja el punto
    // de integracion marcado explicitamente, para no dar una falsa
    // sensacion de sandboxing activo sin la llamada real a la API.
    return {
      success: false,
      error: "Integración con Cloudflare Workers for Platforms pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
