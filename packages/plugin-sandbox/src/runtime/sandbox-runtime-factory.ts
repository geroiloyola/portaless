// Factory de produccion de SandboxRuntime (v0.0.9.30). Es el punto unico
// donde un caller real (endpoint, script, cron) debe construir el runtime:
// asi siempre recibe un CapabilityTokenStore, y es EL MISMO backend que
// valida functions/api/internal/capability-bridge.js (ambos pasan por
// createCapabilityTokenStore(env)):
//   - D1: misma base env.DB, tabla capability_bridge_tokens.
//   - SQLite: misma instancia cacheada del proceso.
//   - Memoria: misma instancia cacheada -- solo sirve si runtime y bridge
//     corren en el mismo proceso (dev/tests). En produccion edge hace
//     falta D1 o SQLite, si no los tokens emitidos no los ve el bridge.
// Construir SandboxRuntime a mano sin tokenStore hace que los adaptadores
// edge fallen ante cualquier capacidad no-red concedida.

import { SandboxRuntime, type PermissionResolver } from "./sandbox-runtime";
import type { AdapterRegistry } from "../adapters/adapter-registry";
import { createCapabilityTokenStore } from "../registry/stores/capability-token-store-factory";

export async function createSandboxRuntime(
  env: { DB?: unknown; PORTALESS_SQLITE_PATH?: string },
  adapterRegistry: AdapterRegistry,
  permissions: PermissionResolver
): Promise<SandboxRuntime> {
  const tokenStore = await createCapabilityTokenStore(env);
  return new SandboxRuntime(adapterRegistry, permissions, tokenStore);
}
