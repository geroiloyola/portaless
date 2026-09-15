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

    // TODO(integracion real -- v0.0.9 deja esto documentado, NO
    // implementado; ver decision explicita del roadmap, item 2). Pasos
    // concretos para cuando se aborde:
    //
    // 1. Empaquetar el binario Wasm de `input.code` (ya compilado; este
    //    adaptador NO compila Wasm, solo lo publica) en un paquete Fastly
    //    (`.tar.gz` con `fastly.toml` + el `.wasm`) y subirlo:
    //    POST https://api.fastly.com/service/{serviceId}/package
    //    Header: `Fastly-Key: ${this.config.apiToken}`.
    //    Doc: https://www.fastly.com/documentation/reference/api/services/package/
    //
    // 2. Activar la version subida:
    //    PUT https://api.fastly.com/service/{serviceId}/version/{version}/activate
    //    -- Fastly versiona servicios completos, no scripts individuales
    //    como Cloudflare/Deno; cada `execute()` de un plugin distinto
    //    implicaria crear una NUEVA version del servicio, lo cual no
    //    escala 1:1 por invocacion. En produccion esto requeriria UN
    //    servicio Fastly fijo por deployment de Portaless (no por
    //    plugin), con el binario Wasm del plugin cargado dinamicamente
    //    dentro del propio Compute@Edge runtime en tiempo de request (via
    //    un mecanismo de plugin-loading en el propio codigo Rust/AssemblyScript
    //    del servicio) en vez de subir un binario nuevo por plugin.
    //
    // 3. Mapear `input.manifest.requestedCapabilities` de tipo
    //    "network:fetch": Compute@Edge requiere declarar los backends
    //    permitidos de antemano en `fastly.toml`/como Backends del
    //    servicio (no hay un allowlist dinamico en tiempo de ejecucion
    //    como en node-isolated-vm.ts) -- cada host nuevo que un plugin
    //    necesite implicaria una nueva version de servicio con ese
    //    Backend agregado, o bien enrutar todo el trafico saliente a
    //    traves de un unico Backend proxy interno que aplique el
    //    allowlist dinamicamente (mas parecido al modelo de Portaless,
    //    pero requiere ese proxy como pieza adicional de infraestructura).
    //    Las 9 capacidades no-red no tienen equivalente nativo y
    //    necesitarian el mismo patron de bridge HTTP interno descrito en
    //    deno-deploy.ts.
    //
    // 4. Invocar: a diferencia de Cloudflare/Deno, Fastly Compute no tiene
    //    un "invocar bajo demanda" desacoplado del dominio publico del
    //    servicio -- ejecutar el plugin es un fetch HTTP normal a la URL
    //    publica (o dominio custom) del servicio activado en (2).
    //
    // 5. Limites: `input.manifest.limits` no tiene mapeo API -- los
    //    limites de CPU/memoria de Compute@Edge son fijos por el runtime
    //    Wasm de Fastly y no configurables por request.
    //
    // Sin (1)-(5) implementado, este adaptador NO debe reportarse como
    // disponible en produccion aunque `isAvailable()` devuelva true.
    return {
      success: false,
      error: "Integración con Fastly Compute pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
