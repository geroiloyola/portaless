// Adaptador self-hosted: ejecuta plugins en un V8 isolate dentro del mismo
// proceso Node, usando la libreria "isolated-vm". Este es el adaptador
// que hace que el sandboxing de Portaless NO dependa de ningun proveedor
// edge -- funciona en un VPS propio, Docker, o cualquier servidor Node.
//
// ADVERTENCIA DE SEGURIDAD (leer antes de usar en producción):
// En agosto de 2026 se publicó una vulnerabilidad crítica de tipo
// "type confusion" en isolated-vm (GHSA-864f-rcv7-6rh4) que permite que
// código sandboxeado escape del isolate y ejecute código arbitrario en el
// proceso host (RCE), afectando todas las versiones <= 7.0.0. Está
// corregida en 6.2.0 y 7.0.1. Este adaptador NUNCA debe usarse sin fijar
// una de esas versiones (o posteriores) como dependencia exacta, y debe
// revisarse contra nuevas CVEs antes de cada despliegue -- ver
// docs/PLUGIN_SANDBOXING.md, sección "Riesgo conocido: isolated-vm".

import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

const MIN_SAFE_VERSIONS = { "6.x": "6.2.0", "7.x": "7.0.1" };

export interface NodeIsolatedVmAdapterConfig {
  memoryLimitMb?: number;      // Límite de memoria del isolate (por defecto 128MB).
  timeoutMs?: number;          // Límite de tiempo de ejecución por invocación.
  installedVersion: string;    // Debe verificarse contra MIN_SAFE_VERSIONS antes de instanciar.
}

export class NodeIsolatedVmAdapter implements SandboxAdapter {
  readonly providerName = "node-isolated-vm";
  readonly supportsWasm = false;

  constructor(private config: NodeIsolatedVmAdapterConfig) {
    this.assertSafeVersion(config.installedVersion);
  }

  private assertSafeVersion(version: string): void {
    const [major] = version.split(".").map(Number);
    const minSafe = major === 6 ? MIN_SAFE_VERSIONS["6.x"] : major === 7 ? MIN_SAFE_VERSIONS["7.x"] : null;
    if (!minSafe || this.isOlderThan(version, minSafe)) {
      throw new Error(
        `isolated-vm@${version} es vulnerable a GHSA-864f-rcv7-6rh4 (RCE). ` +
        `Actualiza a ${minSafe ?? "6.2.0 o 7.0.1"} antes de usar este adaptador en producción.`
      );
    }
  }

  private isOlderThan(a: string, b: string): boolean {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // TODO(integracion real): intentar `await import("isolated-vm")` y
      // verificar que el binario nativo compila correctamente en este host.
      return true;
    } catch {
      return false;
    }
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];

    // TODO(integracion real):
    // 1. Crear un nuevo `ivm.Isolate({ memoryLimit: config.memoryLimitMb })`.
    // 2. Crear un `ivm.Context` fresco -- SIN exponer `require`, `process`,
    //    filesystem ni red por defecto (isolated-vm no los expone salvo que
    //    se inyecten explicitamente).
    // 3. Por cada capability en input.granted, inyectar SOLO la funcion
    //    puente correspondiente (ej. si "network:fetch" esta concedido,
    //    inyectar un `fetch` acotado a los allowedHosts declarados).
    // 4. Ejecutar input.code con un timeout (config.timeoutMs) y capturar
    //    cualquier intento de acceso a una capacidad no inyectada como un
    //    "deniedCapabilityAttempts".
    // 5. IMPORTANTE: dado el historial de CVEs de escape de isolated-vm,
    //    correr este proceso ademas dentro de un contenedor Docker con
    //    seccomp/AppArmor como segunda capa de defensa -- nunca confiar
    //    unicamente en el aislamiento de V8 para codigo no confiable.
    return {
      success: false,
      error: "Ejecución real en isolated-vm pendiente (TODO en el código). Ver advertencia de seguridad en este archivo.",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
