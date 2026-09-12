// Carga manifiestos de plugins desde un directorio (self-hosted) o desde
// un registro remoto de plugins verificados. MVP: solo carga local.

import type { PluginManifest } from "../types";
import { validateManifest } from "./manifest-schema";

export interface ManifestSource {
  loadAll(): Promise<PluginManifest[]>;
}

export class LocalManifestSource implements ManifestSource {
  constructor(private manifests: PluginManifest[]) {}

  async loadAll(): Promise<PluginManifest[]> {
    const valid: PluginManifest[] = [];
    for (const manifest of this.manifests) {
      const result = validateManifest(manifest);
      if (result.valid) {
        valid.push(manifest);
      } else {
        console.warn(
          `[Portaless Plugin Sandbox] Manifiesto rechazado para "${manifest.name}": ${result.errors.join("; ")}`
        );
      }
    }
    return valid;
  }
}
