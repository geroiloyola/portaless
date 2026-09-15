import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../plugin-sandbox/src/adapters/node-isolated-vm";
import type { PluginManifest, GrantedCapabilities } from "../../plugin-sandbox/src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

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

function loadPluginArtifacts(config: CommerceConfig): { manifest: PluginManifest; code: string; granted: GrantedCapabilities } {
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
  const granted: GrantedCapabilities = new Set(cachedManifest.requestedCapabilities.map((c) => c.id));
  return { manifest: cachedManifest, code: cachedCode as string, granted };
}

function getAdapter(): NodeIsolatedVmAdapter {
  if (!cachedAdapter) {
    cachedAdapter = new NodeIsolatedVmAdapter({ installedVersion: getIsolatedVmVersion(), timeoutMs: 8000 });
  }
  return cachedAdapter;
}

async function runPluginAction(config: CommerceConfig, payload: Record<string, unknown>): Promise<unknown> {
  const adapter = getAdapter();
  const available = await adapter.isAvailable();
  if (!available) {
    throw new Error("isolated-vm no esta instalado. Corre: npm install isolated-vm --workspace=@portaless/plugin-sandbox");
  }
  const { manifest, code, granted } = loadPluginArtifacts(config);
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
  } catch {
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

// NOTA: esta funcion asume que plugin-entry.js (el codigo que corre DENTRO
// del isolate) ya reconoce action: "fetchProductByHandle". Si plugin-entry.js
// todavia no implementa esa rama, esta funcion no falla: el plugin
// simplemente no reconoceria la accion y el resultado dependera de su
// manejo por defecto (revisar plugin-entry.js si fetchProductByHandle
// retorna siempre null en runtime).
export async function sandboxedFetchProductByHandle(config: CommerceConfig, handle: string): Promise<any | null> {
  const result = await runPluginAction(config, {
    action: "fetchProductByHandle",
    medusaUrl: config.medusaUrl,
    publishableApiKey: config.publishableApiKey,
    handle,
  });
  return result ?? null;
}
