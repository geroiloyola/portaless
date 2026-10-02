// packages/apw-resolver/src/did-apw/key-id.ts
//
// Identificador DID de una clave del sitio: did:apw:<dominio>#key-<n>
// (APW v1.2, seccion 5.2: es el `kid` de todo JWS firmado por el sitio).
// <n> es la secuencia de la clave, desde 1, y crece con cada rotacion.
//
// No confundir con la huella RFC 7638 (`fingerprint`, ERRATA E-1): esa es la
// que va en `k` del TXT y la que usaron como `kid` las entradas del historial
// creadas antes de E-3. Cada clave publica ambos identificadores. Ver
// docs/protocol-apw/ERRATA.md, E-3.

const KEY_ID_RE = /^(did:apw:[^# ]+)#key-([1-9][0-9]*)$/;

export interface ParsedDidKeyId {
  did: string;
  sequence: number;
}

/** Arma did:apw:<dominio>#key-<n>. Lanza invalid_did o invalid_key_sequence. */
export function didKeyId(did: string, sequence: number): string {
  if (
    typeof did !== 'string' ||
    !did.startsWith('did:apw:') ||
    did.length === 'did:apw:'.length ||
    did.includes('#') ||
    did.includes(' ')
  ) {
    throw new Error('invalid_did');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('invalid_key_sequence');
  return `${did}#key-${sequence}`;
}

/** Devuelve { did, sequence } o null si el valor no es un did:apw:<dominio>#key-<n> valido. */
export function parseDidKeyId(keyId: unknown): ParsedDidKeyId | null {
  if (typeof keyId !== 'string') return null;
  const match = KEY_ID_RE.exec(keyId);
  if (!match) return null;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) ? { did: match[1], sequence } : null;
}

export function isDidKeyId(value: unknown): boolean {
  return parseDidKeyId(value) !== null;
}
