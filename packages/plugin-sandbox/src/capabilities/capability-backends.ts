// Backends reales de las capacidades no-red del sandbox (Fase 14, §14.2).
//
// Fuente unica del `CapabilityHostBridge` real, consumida por:
//   - el endpoint HTTP `functions/api/internal/capability-bridge.js`, que los
//     adaptadores edge (Cloudflare Workers for Platforms, Deno Deploy) usan
//     para invocar capacidades desde el codigo del plugin que corre remoto; y
//   - `runPluginInProduction()`, que lo pasa como `hostBridge` al adaptador
//     self-hosted (`node-isolated-vm`), para que un plugin en self-host tenga
//     EXACTAMENTE los mismos backends que en edge.
//
// Antes cada superficie tenia su propio dispatch y podian divergir; ademas el
// caller de produccion no pasaba `hostBridge`, asi que en self-host
// `content:read` tambien respondia NOT_CONFIGURED. Ahora hay una sola lista.
//
// "Uno a la vez" (Fase 14): cada capacidad se conecta con su store real y el
// resto sigue devolviendo un error explicito NOT_CONFIGURED -- nunca un exito
// silencioso ni un 403 falso (la capacidad SI esta concedida, solo falta el
// backend). Estado hoy: content:read/content:write (PageStore) y
// storage:read/storage:write (PluginStorageStore, cuotas + namespace por
// plugin). Las capacidades de red (network:fetch) no pasan por aqui: las
// maneja cada adaptador.

import type { CapabilityId, CapabilityHostBridge } from "../types";
import { createPageStore } from "../../../atomic-elements/src/persistence/store-factory";
import { createPluginStorageStore } from "../registry/plugin-storage";

export interface CapabilityError extends Error {
  code: string;
}

export function capabilityError(code: string, message: string): CapabilityError {
  const err = new Error(message) as CapabilityError;
  err.name = "CapabilityError";
  err.code = code;
  return err;
}

export function notConfigured(message: string): CapabilityError {
  return capabilityError("NOT_CONFIGURED", message);
}

export interface CapabilityBackendEnv {
  DB?: any;
  PORTALESS_SQLITE_PATH?: string;
}

/**
 * Construye el `CapabilityHostBridge` real. Los stores se crean DENTRO de cada
 * handler (no al construir el bridge): una capacidad que no se usa nunca abre
 * una conexion, y el handler de storage no toca PageStore ni al reves.
 */
export function createCapabilityHostBridge(env: CapabilityBackendEnv = {}): CapabilityHostBridge {
  return {
    contentRead: async (payload) => {
      const slug = (payload as { slug?: unknown })?.slug;
      if (typeof slug !== "string") throw notConfigured("content:read requiere { slug: string }");
      const pageStore = await createPageStore(env);
      const layout = await pageStore.load(slug);
      if (!layout) throw capabilityError("PAGE_NOT_FOUND", `Pagina '${slug}' no encontrada.`);
      return layout;
    },
    contentWrite: async (payload) => {
      const slug = (payload as { slug?: unknown })?.slug;
      if (typeof slug !== "string") throw notConfigured("content:write requiere un PageLayout completo con slug.");
      const pageStore = await createPageStore(env);
      await pageStore.save(payload as never);
      return { success: true };
    },
    storageRead: async (pluginName, payload) => {
      const key = (payload as { key?: unknown })?.key;
      if (typeof key !== "string") throw notConfigured("storage:read requiere { key: string }");
      const store = await createPluginStorageStore(env);
      const entry = await store.get(pluginName, key);
      if (!entry) return { key, value: null, found: false };
      return { key: entry.key, value: entry.value, found: true, updatedAt: entry.updatedAt };
    },
    storageWrite: async (pluginName, payload) => {
      const key = (payload as { key?: unknown })?.key;
      if (typeof key !== "string" || !("value" in (payload as Record<string, unknown>))) {
        throw notConfigured("storage:write requiere { key: string, value: unknown }");
      }
      const store = await createPluginStorageStore(env);
      const saved = await store.set(pluginName, key, (payload as { value: unknown }).value);
      return { key: saved.key, sizeBytes: saved.sizeBytes, updatedAt: saved.updatedAt };
    },
  };
}

export interface CapabilityBackendSpec {
  id: CapabilityId;
  /** Metodo de CapabilityHostBridge que implementa esta capacidad. */
  method: keyof CapabilityHostBridge;
  /** El metodo recibe (pluginName, payload) en vez de solo (payload). */
  withPlugin: boolean;
}

/** Las capacidades que HOY tienen backend real. Una nueva se agrega aqui. */
export const CAPABILITY_BACKENDS: CapabilityBackendSpec[] = [
  { id: "content:read", method: "contentRead", withPlugin: false },
  { id: "content:write", method: "contentWrite", withPlugin: false },
  { id: "storage:read", method: "storageRead", withPlugin: true },
  { id: "storage:write", method: "storageWrite", withPlugin: true },
];

export function hasCapabilityBackend(id: CapabilityId | string): boolean {
  return CAPABILITY_BACKENDS.some((spec) => spec.id === id);
}

/**
 * Enruta una capacidad al handler real del bridge. Lanza NOT_CONFIGURED si la
 * capacidad esta concedida pero todavia no tiene backend (el caller la traduce
 * a 501). El `pluginName` lo fija el caller desde el token/manifiesto, nunca el
 * body del plugin.
 */
export async function dispatchCapability(
  capability: string,
  args: unknown,
  bridge: CapabilityHostBridge,
  pluginName: string
): Promise<unknown> {
  const spec = CAPABILITY_BACKENDS.find((candidate) => candidate.id === capability);
  if (!spec) {
    throw notConfigured(
      `Capacidad '${capability}' concedida, pero sin backend real conectado en este endpoint todavia.`
    );
  }
  const handler = bridge[spec.method] as ((...callArgs: unknown[]) => Promise<unknown>) | undefined;
  if (!handler) {
    throw notConfigured(`Capacidad '${capability}' concedida, pero su handler no esta configurado.`);
  }
  return spec.withPlugin ? handler(pluginName, args) : handler(args);
}
