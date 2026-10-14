// packages/posse-syndicator-plugin/src/host-bridge.ts
// Puente del host para ejecutar posse-syndicator-plugin en el sandbox.
// La fuente de verdad canónica reside en /posts/ (src/content/posts/*.md).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../plugin-sandbox/src/adapters/node-isolated-vm";
import type { PluginManifest, GrantedCapabilities } from "../../plugin-sandbox/src/types";
import { createPermissionStore } from "../../permissions/src/store-factory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

export interface CanonicalPost {
  title: string;
  slug: string;
  excerpt?: string;
  publishedAt?: string;
}

export interface SyndicationOptions {
  siteUrl: string;
  target: "bluesky" | "mastodon";
}

export class PossePermissionError extends Error {
  constructor(pluginName: string, missing: string[]) {
    super(
      `El plugin "${pluginName}" no tiene concedido: ${missing.join(", ")}. ` +
      `Concedelo en /admin/permissions para habilitar la sindicación POSSE.`
    );
    this.name = "PossePermissionError";
  }
}

export async function getConcededCapabilities(pluginName: string): Promise<Set<string>> {
  const store = await createPermissionStore(process.env as { DB?: unknown; PORTALESS_SQLITE_PATH?: string });
  const grants = await store.getGrantsFor({ type: "plugin", id: pluginName, displayName: pluginName });
  return new Set(grants.filter((g) => g.granted).map((g) => g.capabilityId));
}

export function loadPosseManifest(): PluginManifest {
  const raw = readFileSync(join(PLUGIN_ROOT, "manifest.json"), "utf-8");
  return JSON.parse(raw) as PluginManifest;
}

export function loadPosseCode(): string {
  return readFileSync(join(PLUGIN_ROOT, "src", "plugin-entry.js"), "utf-8");
}

export async function formatSyndicationMessage(
  post: CanonicalPost,
  options: SyndicationOptions
): Promise<unknown> {
  const manifest = loadPosseManifest();
  const code = loadPosseCode();

  const conceded = await getConcededCapabilities(manifest.name);
  const requested = manifest.requestedCapabilities.map((c) => c.id);
  const missing = requested.filter((id) => !conceded.has(id));
  if (missing.length > 0) {
    throw new PossePermissionError(manifest.name, missing);
  }

  const granted: GrantedCapabilities = new Set(requested.filter((id) => conceded.has(id)));
  const adapter = new NodeIsolatedVmAdapter({ installedVersion: "7.0.1", timeoutMs: 5000 });

  const result = await adapter.execute({
    manifest,
    granted,
    code,
    payload: {
      action: "formatPayload",
      post,
      target: options.target,
      siteUrl: options.siteUrl,
    },
  });

  if (!result.success) {
    throw new Error(`Error en posse-syndicator-plugin: ${result.error}`);
  }

  return result.output;
}
