// Carga manifiestos de plugins desde un directorio (self-hosted) o desde
// un registro remoto de plugins verificados. MVP: solo carga local.

import type { PluginManifest } from "../types";
import { CORE_VERSION, isEngineCompatible, validateManifest } from "./manifest-schema";

export interface ManifestSource {
  loadAll(): Promise<PluginManifest[]>;
}

export class LocalManifestSource implements ManifestSource {
  constructor(
    private manifests: PluginManifest[],
    private coreVersion: string = CORE_VERSION,
  ) {}

  async loadAll(): Promise<PluginManifest[]> {
    const valid: PluginManifest[] = [];
    for (const manifest of this.manifests) {
      const result = validateManifest(manifest);
      if (!result.valid) {
        console.warn(
          `[Portaless Plugin Sandbox] Manifiesto rechazado para "${manifest.name}": ${result.errors.join("; ")}`
        );
        continue;
      }
      // Compatibilidad declarada con el core: fail-closed, nunca "instalar y ver".
      if (!isEngineCompatible(manifest.engines?.portaless, this.coreVersion)) {
        console.warn(
          `[Portaless Plugin Sandbox] Manifiesto rechazado para "${manifest.name}": requiere Portaless ${manifest.engines?.portaless}, este core es ${this.coreVersion}.`
        );
        continue;
      }
      valid.push(manifest);
    }
    return valid;
  }
}
