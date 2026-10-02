// packages/apw-resolver/src/did-apw/history-log.ts
//
// Historial encadenado del sitio (APW v1.2, seccion 5.4, cierra B6).
//
// Cada atestacion aceptada se agrega al log como un JWS compacto firmado por
// el sitio (EdDSA) con payload { seq, prev, att, ts }:
//   seq  numero de entrada, desde 1
//   prev hash de la entrada anterior (null en la primera)
//   att  hash del JWS del emisor
//   ts   ISO 8601 UTC
// Todos los hashes son base64url sin padding de SHA-256 sobre el JWS tal
// cual (43 caracteres). El hash de la ultima entrada se publica como `h` en
// el TXT. Ver docs/protocol-apw/ERRATA.md, E-2.
//
// Detecta alteracion o borrado de entradas ya publicadas. NO detecta
// omisiones (un sitio puede no aceptar una atestacion desde el inicio): eso
// requiere testigos externos (seccion 7).
//
// Rotacion de claves: cada entrada indica con `kid` que clave la firmo y se
// verifica contra ESA clave, siempre que su `ts` caiga en la ventana
// [valid_from, valid_to] de la clave. Asi rotar no invalida el pasado.
//
// ERRATA E-3: el `kid` del header de las entradas nuevas es el identificador
// DID de la clave (did:apw:<dominio>#key-<n>, APW v1.2 seccion 5.2). Las
// entradas creadas antes (PR #71) usan la huella RFC 7638 como `kid`:
// verifyChain() acepta ambos, asi el historial existente sigue verificando.
//
// Todavia no existe un endpoint que acepte atestaciones de emisores:
// appendAttestation() queda listo y sin caller de produccion.

import { LOG_SEQ_CONFLICT, type AttestationLogEntry, type AttestationLogStore } from './attestation-log-store';
import type { SiteIdentityStore, ActiveSigningKey } from './site-identity-store';
import { jwkThumbprint, publicJwkMembers } from './fingerprint';
import { parseDidKeyId } from './key-id';

const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const COMPACT_JWS_RE = /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/;

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

function b64UrlToBytes(text: string): Uint8Array {
  const base64 = text.split('-').join('+').split('_').join('/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function textToB64Url(text: string): string {
  return bytesToB64Url(new TextEncoder().encode(text));
}

/** base64url(SHA-256(text)), 43 caracteres. */
export async function sha256B64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToB64Url(new Uint8Array(digest));
}

export interface AttestationPayload {
  seq: number;
  prev: string | null;
  att: string;
  ts: string;
}

async function signEntry(payload: AttestationPayload, key: ActiveSigningKey): Promise<string> {
  const header = textToB64Url(JSON.stringify({ alg: 'EdDSA', kid: key.keyId, typ: 'apw-log+jws' }));
  const body = textToB64Url(JSON.stringify(payload));
  const { kty, crv, x, d } = key.privateKeyJwk;
  const privateKey = await crypto.subtle.importKey('jwk', { kty, crv, x, d } as JsonWebKey, { name: 'Ed25519' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${bytesToB64Url(signature)}`;
}

export interface AppendDeps {
  identity: SiteIdentityStore;
  log: AttestationLogStore;
  siteId: string;
  now?: () => Date;
  /** Reintentos ante LOG_SEQ_CONFLICT (escrituras simultaneas). Default 8. */
  maxAttempts?: number;
}

/**
 * Agrega una atestacion (JWS compacto del emisor) al historial del sitio.
 * Lanza: invalid_attestation_jws, site_identity_not_found, duplicate_attestation.
 * La columna `kid` de la entrada guarda la huella RFC 7638 de la clave que
 * firmo; el header del JWS lleva su identificador DID.
 */
export async function appendAttestation(deps: AppendDeps, attestationJws: string): Promise<AttestationLogEntry> {
  if (typeof attestationJws !== 'string' || !COMPACT_JWS_RE.test(attestationJws)) {
    throw new Error('invalid_attestation_jws');
  }
  const attHash = await sha256B64Url(attestationJws);
  const maxAttempts = deps.maxAttempts ?? 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = await deps.identity.getActiveSigningKey(deps.siteId);
    if (!key) throw new Error('site_identity_not_found');
    const head = await deps.log.head(deps.siteId);
    const seq = head ? head.seq + 1 : 1;
    const prev = head ? head.entryHash : null;
    let ts = (deps.now?.() ?? new Date()).toISOString();
    if (head && Date.parse(ts) < Date.parse(head.ts)) ts = head.ts;

    const entryJws = await signEntry({ seq, prev, att: attHash, ts }, key);
    const entry: AttestationLogEntry = {
      siteId: deps.siteId,
      seq,
      entryJws,
      entryHash: await sha256B64Url(entryJws),
      prevHash: prev,
      attHash,
      kid: key.kid,
      ts,
    };
    try {
      await deps.log.append(entry);
      return entry;
    } catch (err) {
      if ((err as Error).message === LOG_SEQ_CONFLICT) continue;
      throw err;
    }
  }
  throw new Error(LOG_SEQ_CONFLICT);
}

/** Clave publica con su ventana de validez, tal como la publica /.well-known/apw-log.json. */
export interface ChainKey {
  /** Huella RFC 7638 de la clave publica (en el JSON publicado tambien como `fingerprint`). */
  kid: string;
  /** did:apw:<dominio>#key-<n>. Ausente en claves de verificadores anteriores a E-3. */
  keyId?: string | null;
  publicKeyJwk: JsonWebKey;
  validFrom: string;
  validTo: string | null;
}

export interface ChainEntry {
  seq: number;
  jws: string;
}

export interface VerifyChainOptions {
  /** `h` publicado en el TXT. Debe coincidir con el hash de alguna entrada de la cadena. */
  anchorHead?: string | null;
  /** `k` publicado en el TXT. Debe ser la clave activa (valid_to null) del log. */
  activeFingerprint?: string | null;
  /** did:apw:<dominio> esperado: todos los keyId publicados deben pertenecer a ese DID. */
  expectedDid?: string | null;
}

export type ChainFailure =
  | 'key_kid_mismatch'
  | 'seq_gap'
  | 'invalid_entry'
  | 'unknown_key'
  | 'bad_signature'
  | 'bad_payload'
  | 'prev_mismatch'
  | 'ts_regression'
  | 'ts_outside_key_window'
  | 'head_mismatch'
  | 'active_key_mismatch';

export interface VerifyChainResult {
  valid: boolean;
  reason?: ChainFailure;
  failedSeq?: number;
  length: number;
  /** Hash de la ultima entrada (null si el log esta vacio o la verificacion fallo antes de terminar). */
  head: string | null;
  /** Ultima seq cubierta por `h` del TXT. Las posteriores existen pero todavia no estan ancladas en el DNS. */
  anchoredSeq: number | null;
}

export async function verifyChain(entries: ChainEntry[], keys: ChainKey[], opts: VerifyChainOptions = {}): Promise<VerifyChainResult> {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const fail = (reason: ChainFailure, failedSeq?: number): VerifyChainResult => ({
    valid: false,
    reason,
    failedSeq,
    length: sorted.length,
    head: null,
    anchoredSeq: null,
  });

  // Cada clave se registra por su huella y, si la publica, por su keyId DID:
  // el `kid` del header de una entrada puede ser cualquiera de los dos.
  const verifyKeys = new Map<string, CryptoKey>();
  const keyById = new Map<string, ChainKey>();
  for (const key of keys) {
    try {
      const pub = publicJwkMembers(key.publicKeyJwk);
      if ((await jwkThumbprint(pub)) !== key.kid) return fail('key_kid_mismatch');
      if (key.keyId !== undefined && key.keyId !== null) {
        const parsed = parseDidKeyId(key.keyId);
        if (!parsed || (opts.expectedDid && parsed.did !== opts.expectedDid)) return fail('key_kid_mismatch');
      }
      const cryptoKey = await crypto.subtle.importKey('jwk', pub, { name: 'Ed25519' }, false, ['verify']);
      const ids = key.keyId ? [key.kid, key.keyId] : [key.kid];
      for (const id of ids) {
        if (keyById.has(id)) return fail('key_kid_mismatch');
        keyById.set(id, key);
        verifyKeys.set(id, cryptoKey);
      }
    } catch {
      return fail('key_kid_mismatch');
    }
  }

  const hashes: string[] = [];
  let prevHash: string | null = null;
  let prevTs = -Infinity;

  for (let i = 0; i < sorted.length; i++) {
    const seq = i + 1;
    const entry = sorted[i];
    if (entry.seq !== seq) return fail('seq_gap', seq);

    const parts = typeof entry.jws === 'string' ? entry.jws.split('.') : [];
    if (parts.length !== 3) return fail('invalid_entry', seq);

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0])));
      payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    } catch {
      return fail('invalid_entry', seq);
    }
    if (!header || header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !payload || typeof payload !== 'object') {
      return fail('invalid_entry', seq);
    }

    const key = keyById.get(header.kid);
    const cryptoKey = verifyKeys.get(header.kid);
    if (!key || !cryptoKey) return fail('unknown_key', seq);

    let signatureOk = false;
    try {
      signatureOk = await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, b64UrlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return fail('bad_signature', seq);

    if (payload.seq !== seq || typeof payload.att !== 'string' || !HASH_RE.test(payload.att) || typeof payload.ts !== 'string') {
      return fail('bad_payload', seq);
    }
    if (payload.prev !== prevHash) return fail('prev_mismatch', seq);

    const tsMs = Date.parse(payload.ts);
    if (Number.isNaN(tsMs)) return fail('bad_payload', seq);
    if (tsMs < prevTs) return fail('ts_regression', seq);
    const from = Date.parse(key.validFrom);
    const to = key.validTo ? Date.parse(key.validTo) : Infinity;
    if (tsMs < from || tsMs > to) return fail('ts_outside_key_window', seq);

    const hash = await sha256B64Url(entry.jws);
    hashes.push(hash);
    prevHash = hash;
    prevTs = tsMs;
  }

  if (opts.activeFingerprint && !keys.some((k) => k.kid === opts.activeFingerprint && k.validTo === null)) {
    return fail('active_key_mismatch');
  }

  let anchoredSeq: number | null = null;
  if (opts.anchorHead) {
    const index = hashes.indexOf(opts.anchorHead);
    if (index < 0) return fail('head_mismatch');
    anchoredSeq = index + 1;
  }

  return { valid: true, length: sorted.length, head: hashes.length > 0 ? hashes[hashes.length - 1] : null, anchoredSeq };
}
