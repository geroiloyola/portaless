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
//
// Vive en su propio archivo (no en index.ts) para evitar un import circular.

import { resolveApwManifest } from '../index';
import { verifyChain, type ChainEntry, type ChainFailure, type ChainKey } from './history-log';

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
}

export interface ResolveHistoryOptions {
  includeEntries?: boolean;
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

function decodePayload(jws: string): any {
  const part = jws.split('.')[1];
  const base64 = part.split('-').join('+').split('_').join('/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
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

  for (let page = 0; page < MAX_PAGES; page++) {
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
    if (doc.next === null || doc.next === undefined) break;
    from = Number(doc.next);
    if (!Number.isInteger(from) || from < 1) return { verified: false, reason: 'invalid_log_document', domain: host };
  }

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
    out.attestations = [...entries]
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const p = decodePayload(e.jws);
        return { seq: p.seq, att: p.att, ts: p.ts };
      });
  }
  return out;
}
