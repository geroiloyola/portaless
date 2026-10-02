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

export interface ApwHistoryResult {
  verified: boolean;
  reason: ApwHistoryReason | string;
  domain: string;
  length?: number;
  head?: string | null;
  anchoredSeq?: number | null;
  unanchoredEntries?: number;
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 40;

export async function resolveApwHistory(domain: string, fetchImpl: typeof fetch = fetch): Promise<ApwHistoryResult> {
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
    if (keys === null) keys = doc.keys as ChainKey[];
    for (const e of doc.entries) entries.push({ seq: e.seq, jws: e.jws });
    if (doc.next === null || doc.next === undefined) break;
    from = Number(doc.next);
    if (!Number.isInteger(from) || from < 1) return { verified: false, reason: 'invalid_log_document', domain: host };
  }

  const result = await verifyChain(entries, keys ?? [], { anchorHead: manifest.h ?? null, activeFingerprint: manifest.k });
  if (!result.valid) {
    return { verified: false, reason: result.reason as ChainFailure, domain: host, length: result.length };
  }
  return {
    verified: true,
    reason: 'ok',
    domain: host,
    length: result.length,
    head: result.head,
    anchoredSeq: result.anchoredSeq,
    unanchoredEntries: result.anchoredSeq === null ? result.length : result.length - result.anchoredSeq,
  };
}
