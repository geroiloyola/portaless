// Motor central de ejecucion de plugins. NUNCA habla directamente con un
// proveedor -- delega toda ejecucion real al SandboxAdapter resuelto, y su
// unica responsabilidad propia es filtrar las capacidades: un plugin solo
// recibe las capacidades que un administrador concedio explicitamente
// desde el Centro de Permisos (packages/permissions), sin importar cuantas
// haya solicitado en su manifiesto.

import type {
  PluginManifest,
  GrantedCapabilities,
  SandboxExecutionResult,
} from "../types";
import { validateManifest } from "../manifest/manifest-schema";
import { AdapterRegistry } from "../adapters/adapter-registry";

export interface PermissionResolver {
  /** Debe consultar packages/permissions para saber que capacidades tiene ESTE plugin en ESTE sitio. */
  getGrantedCapabilities(pluginName: string): Promise<GrantedCapabilities>;
}

export class SandboxRuntime {
  constructor(
    private adapterRegistry: AdapterRegistry,
    private permissions: PermissionResolver
  ) {}

  async runPlugin(manifest: PluginManifest, code: string, payload: unknown): Promise<SandboxExecutionResult> {
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return {
        success: false,
        error: `Manifiesto inválido: ${validation.errors.join("; ")}`,
        deniedCapabilityAttempts: [],
        durationMs: 0,
        provider: "none",
      };
    }

    // Regla de oro: el plugin nunca recibe mas de lo concedido en el
    // Centro de Permisos, sin importar que haya "solicitado" mas en su
    // manifiesto. La solicitud es informativa; la concesion es la unica
    // fuente de verdad de lo que realmente se ejecuta.
    const granted = await this.permissions.getGrantedCapabilities(manifest.name);

    const adapter = await this.adapterRegistry.resolve();

    return adapter.execute({ manifest, granted, code, payload });
  }
}
