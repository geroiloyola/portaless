// packages/apw-resolver/src/did-apw/history-resolver.ts
//
// Verificacion externa del historial encadenado de un dominio (APW v1.2,
// seccion 5.4). Es lo que usaria Portaless Index o cualquier auditor: no
// necesita acceso a la base del sitio ni a la API de su proveedor (Cloudflare,
// self-host u otro). Solo usa el TXT `_apw.<dominio>` y
// https://<dominio>/.well-known/apw-log.json.
//
// Contra el TXT comprueba que:
// - `k` sea la clave activa del log (el DNS ata la lista de claves);
// - `h` sea el hash de alguna entrada de la cadena. Las entradas posteriores
//   a `h` se informan como no ancladas (`unanchoredEntries`): el sitio puede
//   haber agregado entradas desde la ultima vez que se actualizo el DNS.
//
// ERRATA E-3: cada clave publicada trae `fingerprint` (huella RFC 7638, la que
// se compara con `k`) y `keyId` (did:apw:<dominio>#key-<n>, el `kid` de los
// JWS nuevos). Se exige que todos los keyId pertenezcan al DID del dominio.
// Un documento anterior a E-3, sin esos campos, sigue verificando por `kid`.
//
// ERRATA E-9: con { includeEntries: true } devuelve tambien { seq, att, ts }
// de cada entrada, leidos de la cadena YA verificada. Lo usa el cargador de
// reader_conduct para exigir completitud contra apw-attestations.json.
// Cada entrada trae ademas `kid` (el `kid` del header del JWS, con el que la
// firmo): es lo que usa la identidad del lector (6.3) para atar una clave
// no activa a entradas realmente ancladas. Con { includeKeys: true } expone
// tambien `keys` (la lista de claves del log, ya validada contra `k` y contra
// el DID por verifyChain) -- otra vez para 6.3.
//
// Vive en su propio archivo (no en index.ts) para evitar un import circular.

import { resolveApwManifest } from '../index';
import { sha256B64Url, verifyChain, type ChainEntry, type ChainFailure, type ChainKey } from './history-log';

export type ApwHistoryReason =
  | ChainFailure
  | 'manifest_not_resolved'
  | 'manifest_without_key'
  | 'log_unreachable'
  | 'invalid_log_document'
  | 'did_mismatch'
  | 'ok';

export interface ChainAttestationRef {
  seq: number;
  /** Hash del JWS del emisor anotado en esa entrada. */
  att: string;
  ts: string;
  /** `kid` del header de la entrada: la clave (huella o did:apw:...#key-n) que la firmo. */
  kid?: string | null;
  /** Hash de la entrada de cadena misma (sha256 del entry JWS): es el `head` que observan los testigos (5.7). */
  entryHash: string;
}

export interface ApwHistoryResult {
  verified: boolean;
  reason: ApwHistoryReason | string;
  domain: string;
  length?: number;
  head?: string | null;
  anchoredSeq?: number | null;
  unanchoredEntries?: number;
  /** Solo con includeEntries y si la cadena verifico. */
  attestations?: ChainAttestationRef[];
  /** Solo con includeKeys y si la cadena verifico. Claves ya validadas por verifyChain. */
  keys?: ChainKey[];
}

export interface ResolveHistoryOptions {
  includeEntries?: boolean;
  /** Incluye la lista de claves del log (ventanas validFrom/validTo), ya verificada. */
  includeKeys?: boolean;
  /** Techo de paginas para callers con presupuesto (default 40). Una cadena incompleta falla cerrada. */
  maxPages?: number;
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 40;

/** Pasa una clave del documento publicado a ChainKey. `fingerprint` manda sobre el alias `kid`. */
function toChainKey(raw: any): ChainKey {
  return {
    kid: String(raw?.fingerprint ?? raw?.kid ?? ''),
    keyId: typeof raw?.keyId === 'string' ? raw.keyId : null,
    publicKeyJwk: raw?.publicKeyJwk,
    validFrom: raw?.validFrom,
    validTo: raw?.validTo ?? null,
  };
}

function decodeJsonPart(jws: string, index: number): any {
  const part = jws.split('.')[index];
  const base64 = part.split('-').join('+').split('_').join('/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
}

function decodePayload(jws: string): any {
  return decodeJsonPart(jws, 1);
}

/** `kid` del header de un JWS compacto, o null si no se puede leer. */
function decodeHeaderKid(jws: string): string | null {
  try {
    const header = decodeJsonPart(jws, 0);
    return typeof header?.kid === 'string' ? header.kid : null;
  } catch {
    return null;
  }
}

export async function resolveApwHistory(
  domain: string,
  fetchImpl: typeof fetch = fetch,
  options: ResolveHistoryOptions = {}
): Promise<ApwHistoryResult> {
  const host = String(domain || '').trim().toLowerCase().replace(/[.]$/, '');
  const resolution = await resolveApwManifest(host, fetchImpl);
  if (!resolution.resolved || !resolution.manifest) {
    return { verified: false, reason: resolution.reason, domain: host };
  }
  const manifest = resolution.manifest;
  if (!manifest.k) return { verified: false, reason: 'manifest_without_key', domain: host };

  const entries: ChainEntry[] = [];
  let keys: ChainKey[] | null = null;
  let from = 1;
  let hasMore = false;
  const pageCap = Math.min(Math.max(Math.trunc(options.maxPages ?? MAX_PAGES), 1), MAX_PAGES);

  for (let page = 0; page < pageCap; page++) {
    let doc: any;
    try {
      const res = await fetchImpl(`https://${host}/.well-known/apw-log.json?from=${from}&limit=${PAGE_LIMIT}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return { verified: false, reason: 'log_unreachable', domain: host };
      doc = await res.json();
    } catch {
      return { verified: false, reason: 'log_unreachable', domain: host };
    }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries) || !Array.isArray(doc.keys)) {
      return { verified: false, reason: 'invalid_log_document', domain: host };
    }
    if (doc.did !== `did:apw:${host}`) return { verified: false, reason: 'did_mismatch', domain: host };
    if (keys === null) keys = doc.keys.map(toChainKey);
    for (const e of doc.entries) entries.push({ seq: e.seq, jws: e.jws });
    if (doc.next === null || doc.next === undefined) { hasMore = false; break; }
    from = Number(doc.next);
    if (!Number.isInteger(from) || from < 1) return { verified: false, reason: 'invalid_log_document', domain: host };
    hasMore = true;
  }
  if (hasMore) return { verified: false, reason: 'log_unreachable', domain: host };

  const result = await verifyChain(entries, keys ?? [], {
    anchorHead: manifest.h ?? null,
    activeFingerprint: manifest.k,
    expectedDid: `did:apw:${host}`,
  });
  if (!result.valid) {
    return { verified: false, reason: result.reason as ChainFailure, domain: host, length: result.length };
  }

  const out: ApwHistoryResult = {
    verified: true,
    reason: 'ok',
    domain: host,
    length: result.length,
    head: result.head,
    anchoredSeq: result.anchoredSeq,
    unanchoredEntries: result.anchoredSeq === null ? result.length : result.length - result.anchoredSeq,
  };
  if (options.includeEntries) {
    const refs: ChainAttestationRef[] = [];
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      const p = decodePayload(e.jws);
      refs.push({ seq: p.seq, att: p.att, ts: p.ts, kid: decodeHeaderKid(e.jws), entryHash: await sha256B64Url(e.jws) });
    }
    out.attestations = refs;
  }
  if (options.includeKeys) out.keys = keys ?? [];
  return out;
}
