import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "@portaless/plugin-sandbox/node-isolated-vm";
import type { PluginManifest, GrantedCapabilities } from "@portaless/plugin-sandbox/types";
import { createPermissionStore } from "@portaless/permissions/store-factory";

// Host bridge del nodo Portaless (L5) para commerce-plugin.
// El paquete packages/commerce-plugin solo contiene el artefacto del plugin
// (manifest.json + src/plugin-entry.js), sin importar internos del core.
//
// Regla de seguridad (v0.0.9.30): granted = lo que el admin concedio para el
// subject { type: "plugin", id: manifest.name } INTERSECCION lo que declara el
// manifiesto.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "../../packages/commerce-plugin");

export interface CommerceConfig {
  medusaUrl: string;
  publishableApiKey?: string;
  currency?: string;
}

let cachedAdapter: NodeIsolatedVmAdapter | null = null;
let cachedManifest: PluginManifest | null = null;
let cachedCode: string | null = null;

function getIsolatedVmVersion(): string {
  try {
    const pkgPath = join(PLUGIN_ROOT, "..", "plugin-sandbox", "node_modules", "isolated-vm", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version as string;
  } catch {
    return "7.0.1";
  }
}

export class CommercePermissionError extends Error {
  constructor(pluginName: string, missing: string[]) {
    super(
      `El plugin "${pluginName}" no tiene concedido: ${missing.join(", ")}. ` +
        `Concedelo en /admin/permissions para que la tienda muestre productos.`
    );
    this.name = "CommercePermissionError";
  }
}

async function getConcededCapabilities(pluginName: string): Promise<Set<string>> {
  const store = await createPermissionStore(process.env as { DB?: unknown; PORTALESS_SQLITE_PATH?: string });
  const grants = await store.getGrantsFor({ type: "plugin", id: pluginName, displayName: pluginName });
  return new Set(grants.filter((g) => g.granted).map((g) => g.capabilityId));
}

async function loadPluginArtifacts(config: CommerceConfig): Promise<{ manifest: PluginManifest; code: string; granted: GrantedCapabilities }> {
  if (!cachedManifest || !cachedCode) {
    const manifestRaw = readFileSync(join(PLUGIN_ROOT, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as PluginManifest;
    const medusaHost = new URL(config.medusaUrl).host;
    manifest.requestedCapabilities = manifest.requestedCapabilities.map((cap) =>
      cap.id === "network:fetch" ? { ...cap, allowedHosts: [medusaHost] } : cap
    );
    cachedManifest = manifest;
    cachedCode = readFileSync(join(PLUGIN_ROOT, "src", "plugin-entry.js"), "utf-8");
  }

  const conceded = await getConcededCapabilities(cachedManifest.name);
  const requested = cachedManifest.requestedCapabilities.map((c) => c.id);
  const missing = requested.filter((id) => !conceded.has(id));
  if (missing.length > 0) throw new CommercePermissionError(cachedManifest.name, missing);

  const granted: GrantedCapabilities = new Set(requested.filter((id) => conceded.has(id)));
  return { manifest: cachedManifest, code: cachedCode as string, granted };
}

const COMMERCE_POOL_MAX_ISOLATES = 4;

function getAdapter(): NodeIsolatedVmAdapter {
  if (!cachedAdapter) {
    cachedAdapter = new NodeIsolatedVmAdapter({
      installedVersion: getIsolatedVmVersion(),
      timeoutMs: 8000,
      poolMaxIsolates: COMMERCE_POOL_MAX_ISOLATES,
    });
  }
  return cachedAdapter;
}

/** Solo para tests/diagnostico: expone cuantos isolates estan vivos/libres en el pool del commerce-plugin. */
export function getCommercePoolStats(): { idle: number; live: number; max: number } | null {
  return cachedAdapter?.poolStats ?? null;
}

/** Solo para tests: fuerza la recreacion del adaptador (y por tanto del pool) en la proxima llamada. */
export function __resetCommerceAdapterForTests(): void {
  cachedAdapter?.disposePool();
  cachedAdapter = null;
  cachedManifest = null;
  cachedCode = null;
}

async function runPluginAction(config: CommerceConfig, payload: Record<string, unknown>): Promise<unknown> {
  const adapter = getAdapter();
  const available = await adapter.isAvailable();
  if (!available) {
    throw new Error("isolated-vm no esta instalado. Corre: npm install isolated-vm --workspace=@portaless/plugin-sandbox");
  }
  const { manifest, code, granted } = await loadPluginArtifacts(config);
  const result = await adapter.execute({ manifest, granted, code, payload });
  if (!result.success) {
    throw new Error(`Error ejecutando commerce-plugin en el sandbox: ${result.error}`);
  }
  return result.output;
}

export async function sandboxedIsCommerceEnabled(config: CommerceConfig | null): Promise<boolean> {
  if (!config?.medusaUrl) return false;
  try {
    return Boolean(await runPluginAction(config, { action: "isCommerceEnabled", medusaUrl: config.medusaUrl }));
  } catch (err) {
    if (err instanceof CommercePermissionError) console.warn(`[Portaless Commerce] ${err.message}`);
    return false;
  }
}

export async function sandboxedFetchProducts(config: CommerceConfig): Promise<any[]> {
  const result = await runPluginAction(config, {
    action: "fetchProducts",
    medusaUrl: config.medusaUrl,
    publishableApiKey: config.publishableApiKey,
  });
  return Array.isArray(result) ? result : [];
}

export async function sandboxedFetchProductByHandle(config: CommerceConfig, handle: string): Promise<any | null> {
  const result = await runPluginAction(config, {
    action: "fetchProductByHandle",
    medusaUrl: config.medusaUrl,
    publishableApiKey: config.publishableApiKey,
    handle,
  });
  return result ?? null;
}
