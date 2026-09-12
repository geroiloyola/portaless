// Adaptador para Deno Deploy, alternativa a Cloudflare basada en el mismo
// principio de isolates V8 por tenant, pero con su propio runtime (Deno)
// y sus propios permisos nativos (--allow-net, --allow-read, etc.), que
// mapean de forma natural al modelo de capacidades de Portaless.

import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

export interface DenoDeployAdapterConfig {
  projectId: string;
  apiToken: string;
}

export class DenoDeployAdapter implements SandboxAdapter {
  readonly providerName = "deno-deploy";
  readonly supportsWasm = true;

  constructor(private config: DenoDeployAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.projectId && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];

    // TODO(integracion real): desplegar `input.code` como una revision de
    // Deno Deploy y invocarla via su API, traduciendo cada
    // CapabilityRequest de red a los permisos nativos de Deno
    // (--allow-net=<hosts>) en el manifiesto de despliegue.
    return {
      success: false,
      error: "Integración con Deno Deploy pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
