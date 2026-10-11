// packages/permissions/src/reader-bypass.ts
//
// Excepcion por lector de la gobernanza de lectura (APW 6.5, ERRATA E-8):
// un grant `trust:read-governance-bypass` del Centro de Permisos sobre el
// DID de un lector (`did:apw:<dominio>`) permite leer `GET /trust/:siteId`
// aunque no cumpla los umbrales de reputacion de `site_trust_read_policies`.
//
// Que NO exime (normativo):
//   - Web Bot Auth (draft-03) con firma valida: sin firma, 401.
//   - Identidad APW del lector (6.3): la clave firmante debe ser `k` del
//     TXT del origen Signature-Agent y su historial debe verificar.
//   - `require_apw_identity`, fijo en 1 en la politica.
// Es decir: el bypass salta los umbrales R-01/R-05, no la identidad. Un
// DID que no se puede comprobar (`apw_unresolvable`) sigue quedando en
// `on_fail`, grant o no: no hay forma de saber que esa request es de ese
// lector.
//
// El subject no se inventa: el DID del lector lo determina su propia
// politica de lectura; el administrador solo decide si ese DID queda
// exento. Por eso el grant se teclea (o se revoca), no se "solicita".

import type { PermissionStore } from "./permission-store";
import type { PermissionSubject } from "./types";

export const READ_GOVERNANCE_BYPASS_CAPABILITY = "trust:read-governance-bypass";
export const READER_SUBJECT_TYPE = "reader";

const DID_PREFIX = "did:apw:";

/** true si el valor tiene forma de `did:apw:<dominio>` (sin fragmento, sin espacios). */
export function isReaderDid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(DID_PREFIX) &&
    value.length > DID_PREFIX.length &&
    !/[\s#/?]/.test(value.slice(DID_PREFIX.length))
  );
}

/** Subject del Centro de Permisos para el DID de un lector. */
export function readerSubject(did: string): PermissionSubject {
  return { type: READER_SUBJECT_TYPE, id: did, displayName: did };
}

/**
 * true si el DID del lector tiene un grant activo de bypass.
 * Un valor que no es un DID, o un store que falla, nunca concede: fail-closed
 * del lado del bypass (el lector sigue evaluandose contra la politica).
 */
export async function hasReadGovernanceBypass(store: PermissionStore, did: unknown): Promise<boolean> {
  if (!isReaderDid(did)) return false;
  try {
    const grants = await store.getGrantsFor(readerSubject(did));
    return grants.some((g) => g.capabilityId === READ_GOVERNANCE_BYPASS_CAPABILITY && g.granted);
  } catch {
    return false;
  }
}

/**
 * Valida un grant de subject "reader" escrito por el Centro de Permisos.
 * Devuelve null si es valido, o el motivo del rechazo.
 */
export function validateReaderGrant(capabilityId: unknown): string | null {
  if (capabilityId !== READ_GOVERNANCE_BYPASS_CAPABILITY) {
    return `Un subject 'reader' solo admite la capacidad '${READ_GOVERNANCE_BYPASS_CAPABILITY}'.`;
  }
  return null;
}
