// Selecciona el adaptador de sandboxing disponible, en orden de
// preferencia, sin acoplar el resto de Portaless a ningun proveedor
// especifico. Un sitio puede correr sobre Cloudflare, Deno Deploy, Fastly,
// o completamente self-hosted con isolated-vm -- el resto del sistema
// (runtime/sandbox-runtime.ts) es indiferente a cual se use.

import type { SandboxAdapter } from "../types";

export class AdapterRegistry {
  private adapters: SandboxAdapter[] = [];

  register(adapter: SandboxAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Devuelve el primer adaptador disponible, en el orden en que fueron
   * registrados. Se recomienda registrar primero el proveedor edge
   * preferido del sitio, y como ultima opcion el adaptador self-hosted
   * (isolated-vm), que siempre deberia estar disponible como fallback.
   */
  async resolve(): Promise<SandboxAdapter> {
    for (const adapter of this.adapters) {
      if (await adapter.isAvailable()) return adapter;
    }
    throw new Error(
      "Ningún adaptador de sandboxing disponible. Configura al menos un proveedor " +
      "(Cloudflare Workers for Platforms, Deno Deploy, Fastly Compute) o habilita " +
      "el adaptador self-hosted (isolated-vm)."
    );
  }

  listRegistered(): string[] {
    return this.adapters.map((a) => a.providerName);
  }
}
