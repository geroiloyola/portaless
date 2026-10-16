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
// backend). Estado hoy: content:read/content:write (PageStore),
// storage:read/storage:write (PluginStorageStore, cuotas + namespace por
// plugin) y agent:identify (lectura del ledger de uso del Trust Layer). Las
// capacidades de red (network:fetch) no pasan por aqui: las maneja cada
// adaptador.

import type { CapabilityId, CapabilityHostBridge } from "../types";
import { createPageStore } from "../../../atomic-elements/src/persistence/store-factory";
import { createPluginStorageStore } from "../registry/plugin-storage";
import { createUsageLedgerStore } from "../../../trust-layer/src/ledger/store-factory";

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

function parseBoundedInt(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw capabilityError("INVALID_ARGS", `agent:identify: '${name}' debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function periodForOffsetUtc(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
    // Solo LECTURA del ledger de uso de agentes (Trust Layer), agregado por
    // operador. Expone exactamente los mismos campos que ya publica
    // /.well-known/portaless-usage-log.json (operatorKeyId ya es publico por
    // diseno de Web Bot Auth; contadores agregados, nunca contenido de las
    // requests). No hay proveedor externo: lee el mismo ledger que el middleware
    // escribe.
    agentIdentify: async (payload) => {
      const args = (payload ?? {}) as { months?: unknown; limit?: unknown };
      const months = parseBoundedInt(args.months, "months", 3, 1, 12);
      const limit = parseBoundedInt(args.limit, "limit", 50, 1, 200);
      const store = await createUsageLedgerStore(env);
      const periodsCovered = Array.from({ length: months }, (_, i) => periodForOffsetUtc(i));

      interface AgentAcc {
        operatorKeyId: string;
        operatorNameClaimed?: string;
        readerDid?: string;
        requestsTotal: number;
        requestsCharged: number;
        requestsFreeTier: number;
        revenueUsd: number;
        policyViolationsDetected: number;
        firstSeen: string;
        lastSeen: string;
      }
      const byOperator = new Map<string, AgentAcc>();
      for (const period of periodsCovered) {
        const log = await store.get(period);
        for (const entry of log?.agents ?? []) {
          const acc = byOperator.get(entry.operatorKeyId) ?? {
            operatorKeyId: entry.operatorKeyId,
            requestsTotal: 0,
            requestsCharged: 0,
            requestsFreeTier: 0,
            revenueUsd: 0,
            policyViolationsDetected: 0,
            firstSeen: entry.firstSeen,
            lastSeen: entry.lastSeen,
          };
          if (entry.operatorNameClaimed) acc.operatorNameClaimed = entry.operatorNameClaimed;
          if (entry.readerDid) acc.readerDid = entry.readerDid;
          acc.requestsTotal += entry.requestsTotal;
          acc.requestsCharged += entry.requestsCharged;
          acc.requestsFreeTier += entry.requestsFreeTier;
          acc.revenueUsd += entry.revenueUsd;
          acc.policyViolationsDetected += entry.policyViolationsDetected;
          if (entry.firstSeen < acc.firstSeen) acc.firstSeen = entry.firstSeen;
          if (entry.lastSeen > acc.lastSeen) acc.lastSeen = entry.lastSeen;
          byOperator.set(entry.operatorKeyId, acc);
        }
      }

      const agents = [...byOperator.values()]
        .sort((a, b) => b.requestsTotal - a.requestsTotal)
        .slice(0, limit);
      return { agents, periodsCovered, generatedAt: new Date().toISOString() };
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

// Decision registrada (ROADMAP §14.2 item 3): `site:admin` y `email:send` NO se
// conectan aqui mientras no exista un caso de uso concreto y revisado.
//   - site:admin ("modificar configuracion global del sitio") es la capacidad de
//     mayor riesgo; el panel admin con step-up ya cubre la necesidad del dueno,
//     y ningun documento define que operaciones expondria a un plugin. Sin esa
//     definicion, conectarla seria inventar superficie de ataque.
//   - email:send tiene un transporte server (packages/auth/src/email-sender.ts)
//     que su propio encabezado declara que NO es el puente de plugins; dejaria a
//     un plugin enviando email COMO el sitio (vector de spam) y necesita diseno
//     de cuota/rate-limit por plugin y una decision de identidad de remitente.
// El resto (media:*, commerce:*) necesita proveedor externo o namespace propio.

/** Las capacidades que HOY tienen backend real. Una nueva se agrega aqui. */
export const CAPABILITY_BACKENDS: CapabilityBackendSpec[] = [
  { id: "content:read", method: "contentRead", withPlugin: false },
  { id: "content:write", method: "contentWrite", withPlugin: false },
  { id: "storage:read", method: "storageRead", withPlugin: true },
  { id: "storage:write", method: "storageWrite", withPlugin: true },
  { id: "agent:identify", method: "agentIdentify", withPlugin: false },
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
