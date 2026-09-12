// Validacion del manifiesto de un plugin antes de permitir que se registre
// o ejecute. Ningun plugin puede solicitar una capacidad que no exista en
// el catalogo, y "network:fetch" siempre debe declarar hosts explicitos --
// nunca acceso de red sin restriccion.

import type { PluginManifest, CapabilityId } from "../types";
import { capabilityRegistry } from "../capabilities/capability-registry";

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest.name) errors.push('Falta "name" en el manifiesto.');
  if (!manifest.entry) errors.push('Falta "entry" en el manifiesto.');

  for (const req of manifest.requestedCapabilities) {
    if (!capabilityRegistry[req.id as CapabilityId]) {
      errors.push(`Capacidad desconocida solicitada: "${req.id}"`);
      continue;
    }
    if (req.id === "network:fetch" && (!req.allowedHosts || req.allowedHosts.length === 0)) {
      errors.push('"network:fetch" requiere declarar al menos un host en "allowedHosts".');
    }
    if (!req.reason || req.reason.trim().length < 8) {
      errors.push(`La capacidad "${req.id}" debe declarar una razón legible (mínimo 8 caracteres).`);
    }
  }

  return { valid: errors.length === 0, errors };
}
