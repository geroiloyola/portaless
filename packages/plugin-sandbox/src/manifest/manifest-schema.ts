// Validacion del manifiesto de un plugin antes de permitir que se registre
// o ejecute. Ningun plugin puede solicitar una capacidad que no exista en
// el catalogo, y "network:fetch" siempre debe declarar hosts explicitos --
// nunca acceso de red sin restriccion.

import type { PluginManifest, CapabilityId } from "../types";
import { capabilityRegistry, MCP_ONLY_CAPABILITIES } from "../capabilities/capability-registry";

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Version del core para el chequeo de `engines.portaless`. Un test la fija
 * contra package.json (tests/unit/plugin-sdk-parity.test.ts) para que no
 * derive en silencio.
 */
export const CORE_VERSION = "0.0.10";

/**
 * ¿La version del core satisface el rango de `engines.portaless`? Misma
 * implementacion que el SDK (paridad fijada por test). Sin declarar = compatible
 * (fallback seguro); sintaxis desconocida = incompatible (fail-closed).
 */
export function isEngineCompatible(range: string | undefined, version: string): boolean {
  const r = String(range ?? "").trim();
  const v = String(version ?? "").trim();
  if (!r) return true;
  const parse = (s: string) => s.replace(/^[^0-9]*/, "").split(".").map((n) => Number(n) || 0);
  const [maj, min, pat] = parse(v);
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  for (const part of r.split("||").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return false;
    const op = m[1] ?? "=";
    const target = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
    const c = cmp([maj, min, pat], target);
    const ok =
      op === "=" ? c === 0 :
      op === ">=" ? c >= 0 :
      op === "<=" ? c <= 0 :
      op === ">" ? c > 0 :
      op === "<" ? c < 0 :
      op === "^" ? c >= 0 && maj === target[0] :
      op === "~" ? c >= 0 && maj === target[0] && min === target[1] :
      false;
    if (ok) return true;
  }
  return false;
}

export function validateManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest.name) errors.push('Falta "name" en el manifiesto.');
  if (!manifest.entry) errors.push('Falta "entry" en el manifiesto.');

  if (manifest.engines !== undefined) {
    if (typeof manifest.engines !== "object" || manifest.engines === null) {
      errors.push('"engines" debe ser un objeto (ej. { "portaless": "^0.0.10" }).');
    } else if (manifest.engines.portaless !== undefined && (typeof manifest.engines.portaless !== "string" || !manifest.engines.portaless.trim())) {
      errors.push('"engines.portaless" debe ser un rango semver no vacio.');
    }
  }

  // Sin este guard, un manifest sin requestedCapabilities reventaba con
  // TypeError (no iterable) y tumbaria loadAll() de LocalManifestSource
  // entero -- un manifiesto malo debe fallar como validacion, no como
  // excepcion.
  const requested = Array.isArray(manifest.requestedCapabilities) ? manifest.requestedCapabilities : null;
  if (!requested) {
    errors.push('Falta "requestedCapabilities" (array, puede ser vacio) en el manifiesto.');
  }

  for (const req of requested ?? []) {
    if (!capabilityRegistry[req.id as CapabilityId]) {
      errors.push(`Capacidad desconocida solicitada: "${req.id}"`);
      continue;
    }
    if (MCP_ONLY_CAPABILITIES.has(req.id as CapabilityId)) {
      errors.push(`"${req.id}" es una capacidad exclusiva de MCP y no puede solicitarse en manifiestos de plugins.`);
      continue;
    }
    // APW 6.5: la excepcion de gobernanza de lectura no es de plugins: su
    // subject es el DID de un lector, concedido desde el Centro de Permisos.
    if (req.id === "trust:read-governance-bypass") {
      errors.push('"trust:read-governance-bypass" no es una capacidad de plugins: se concede por DID de lector en el Centro de Permisos.');
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
