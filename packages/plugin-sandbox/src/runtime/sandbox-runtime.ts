// Motor central de ejecucion de plugins. NUNCA habla directamente con un
// proveedor -- delega toda ejecucion real al SandboxAdapter resuelto, y su
// unica responsabilidad propia es filtrar las capacidades: un plugin solo
// recibe las capacidades que un administrador concedio explicitamente
// desde el Centro de Permisos (packages/permissions), sin importar cuantas
// haya solicitado en su manifiesto.
//
// v0.0.9.27: si se provee un CapabilityTokenStore, el runtime pasa a los
// adaptadores un issueCapabilityToken() real. Es el caller que faltaba
// desde v0.0.9.26: sin el, deno-deploy.ts y cloudflare-workers-for-platforms.ts
// fallaban explicito ante cualquier capacidad no-red concedida.
//   - El token se registra con el snapshot de `granted` resuelto AQUI (el
//     mismo que recibe el adaptador), no con lo que pida el adaptador.
//   - Se rechaza emitir para un pluginName distinto al del manifiesto en
//     ejecucion: un adaptador con un bug no puede obtener tokens ajenos.
//   - El store es opcional para no romper a los callers actuales ni al
//     adaptador self-hosted (node-isolated-vm.ts), que no usa tokens HTTP.

import type {
  PluginManifest,
  GrantedCapabilities,
  SandboxExecutionResult,
} from "../types";
import { validateManifest } from "../manifest/manifest-schema";
import { AdapterRegistry } from "../adapters/adapter-registry";
import type { CapabilityTokenStore } from "../registry/stores/capability-token-store";

export interface PermissionResolver {
  /** Debe consultar packages/permissions para saber que capacidades tiene ESTE plugin en ESTE sitio. */
  getGrantedCapabilities(pluginName: string): Promise<GrantedCapabilities>;
}

function randomTokenSuffix(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class SandboxRuntime {
  constructor(
    private adapterRegistry: AdapterRegistry,
    private permissions: PermissionResolver,
    private tokenStore?: CapabilityTokenStore
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

    const tokenStore = this.tokenStore;
    const issueCapabilityToken = tokenStore
      ? async (pluginName: string) => {
          if (pluginName !== manifest.name) {
            throw new Error(
              `issueCapabilityToken: se pidio un token para "${pluginName}" durante la ejecucion de "${manifest.name}"`
            );
          }
          const issued = await tokenStore.issue(`pless_${randomTokenSuffix()}`, manifest.name, [...granted]);
          return { token: issued.token, expiresAt: issued.expiresAt };
        }
      : undefined;

    return adapter.execute({ manifest, granted, code, payload, issueCapabilityToken });
  }
}
