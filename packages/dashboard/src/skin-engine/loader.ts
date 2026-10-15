// Carga un skin.json y resuelve su cadena de herencia ("extends"),
// fusionando tokens con el skin padre. Ver Portaless_Skin_System.md,
// seccion 3.1.
//
// Fase 10: el loader resuelve SOLO tokens. El antiguo merge de "layout"
// (organismos/gridPos) se retiro junto con el sistema de organismos mock:
// nunca se renderizaba en produccion. Un skin es un preset de tokens.

import type { SkinManifest, ResolvedSkin, DesignTokens } from "../types";
import { DEFAULT_TOKENS } from "./tokens";

export interface SkinSource {
  /** Devuelve el manifiesto crudo de un skin por nombre (ej. "base", "tienda"). */
  get(name: string): Promise<SkinManifest>;
}

/**
 * Fuente de skins basada en un mapa en memoria — util para el MVP y para
 * pruebas. En produccion, implementar SkinSource contra fetch() de archivos
 * estaticos servidos junto al panel de administracion.
 */
export class StaticSkinSource implements SkinSource {
  constructor(private manifests: Record<string, SkinManifest>) {}
  async get(name: string): Promise<SkinManifest> {
    const manifest = this.manifests[name];
    if (!manifest) throw new Error(`Skin "${name}" no encontrado.`);
    return manifest;
  }
}

function mergeTokens(base: DesignTokens, override: DesignTokens): DesignTokens {
  return { ...base, ...override };
}

/**
 * Resuelve un skin completo, siguiendo la cadena de "extends" hasta llegar
 * a un skin sin padre (normalmente "base"). Detecta ciclos para evitar
 * loops infinitos por un skin mal configurado.
 */
export async function resolveSkin(
  name: string,
  source: SkinSource,
  visited: Set<string> = new Set()
): Promise<ResolvedSkin> {
  if (visited.has(name)) {
    throw new Error(`Ciclo de herencia detectado en el skin "${name}".`);
  }
  visited.add(name);

  const manifest = await source.get(name);

  if (!manifest.extends) {
    return {
      skin: manifest.skin,
      tokens: mergeTokens(DEFAULT_TOKENS, manifest.tokens ?? {}),
    };
  }

  const parent = await resolveSkin(manifest.extends, source, visited);
  return {
    skin: manifest.skin,
    tokens: mergeTokens(parent.tokens, manifest.tokens ?? {}),
  };
}
