// Adaptador para Fastly Compute@Edge, que ejecuta el codigo del plugin
// compilado a WebAssembly en lugar de un isolate de JavaScript -- una
// tercera familia de aislamiento distinta a V8, util si un plugin se
// distribuye como binario Wasm en vez de JS/TS.

import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

export interface FastlyComputeAdapterConfig {
  serviceId: string;
  apiToken: string;
}

export class FastlyComputeAdapter implements SandboxAdapter {
  readonly providerName = "fastly-compute";
  readonly supportsWasm = true;

  constructor(private config: FastlyComputeAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.serviceId && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];

    if (input.manifest.runtime !== "wasm") {
      return {
        success: false,
        error: "El adaptador de Fastly Compute en este MVP solo soporta plugins runtime=\"wasm\".",
        deniedCapabilityAttempts: deniedAttempts,
        durationMs: Date.now() - start,
        provider: this.providerName,
      };
    }

    // TODO(integracion real): publicar el binario Wasm a un servicio de
    // Fastly Compute y invocarlo via su API HTTP.
    return {
      success: false,
      error: "Integración con Fastly Compute pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
