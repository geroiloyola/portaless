// packages/apw-resolver/src/did-apw/witness-index.ts
//
// Portaless Index -- agregador de testigos (APW v1.3, 5.7 y seccion 7).
// Los primitivos de 5.7 (witness.ts) ya permiten a CADA sitio anotar y
// verificar observaciones; esto agrega la pieza que la spec deja en "quien
// evalua decide que testigos escuchar": un nodo que consulta a un set de
// testigos configurados, verifica sus statements de punta a punta, guarda
// las observaciones y publica un directorio por sujeto con hallazgos y un
// consenso ponderado.
//
// Pipeline por testigo (todo fail-closed; un fallo saltea al testigo entero
// o al statement, nunca confia en lo no verificado):
//   1. cadena DEL TESTIGO verificada (resolveHistory: TXT + apw-log.json);
//   2. /.well-known/apw-witnesses.json del testigo, con `did` = al suyo;
//   3. el statement esta anclado: att === sha256(jws) en esa cadena y su
//      seq existe en ella (la fecha creible es el ts de la ENTRADA DEL
//      TESTIGO, no el ts declarado en el payload);
//   4. firma contra la clave del testigo (verifyWitnessStatement, con jti
//      determinista e iss/sub esperados).
//
// Que SI detecta (contra la cadena actual del sujeto, evaluateWitnesses):
// head_mismatch, equivocation y backdated_entry; el directorio agrega un
// `status` por sujeto y un `consensus` ponderado por la ultima seq observada.
// Calibracion de pesos estilo A.4.4 (Phase 5): un testigo gana peso
// acertando con el consenso y lo pierde disintiendo -- witnessCalibrationFactor
// mapea los contadores acuerdo/desacuerdo a un factor multiplicativo suave
// (arranca en 1.0, tope ~1.9, piso ~0.1); el peso BASE del operador sigue
// siendo un multiplicador sobre ese factor. Sincronizacion entre nodos
// (Phase 5): syncIndexPeers baja el apw-index.json de los pares
// configurados y usa sus entradas como DESCUBRIMIENTO de sujetos/testigos,
// re-verificando todo localmente con el mismo pipeline fail-closed -- un par
// nunca inyecta observaciones sin verificar. Que sigue sin hacer: agregar
// manifiestos/SiteTrustScore de otras instancias (seccion 7).

import { sha256B64Url } from './history-log';
import { evaluateWitnesses, verifyWitnessStatement, type WitnessFinding } from './witness';
import type { ApwHistoryResult, ChainAttestationRef } from './history-resolver';
import {
  assertWitnessWeight,
  MAX_WITNESS_WEIGHT,
  type WitnessIndexStore,
  type WitnessObservationRecord,
  type PeerSyncStatus,
} from './witness-index-store';

export const INDEX_DOC_TYP = 'apw-index';

/** Paginas maximas leidas del apw-witnesses.json de cada testigo (500 statements c/u). */
export const MAX_WITNESS_PAGES = 10;
const WITNESS_PAGE_LIMIT = 500;

export interface IndexDeps {
  /** GET de texto remoto; null = no accesible o invalido (fail-closed). */
  fetchText(url: string): Promise<string | null>;
  /** Historia de un dominio, resuelta con includeEntries + includeKeys en el wiring real. */
  resolveHistory(domain: string): Promise<ApwHistoryResult>;
  now?: () => Date;
}

export interface WitnessSkip {
  witnessDomain: string;
  reason: string;
}

export interface IndexObservation {
  witnessDid: string;
  seq: number;
  head: string | null;
  /** ts de la entrada del historial DEL TESTIGO donde se anoto (fecha creible). */
  anchoredTs: string;
  jti: string;
  /** Peso EFECTIVO usado en el consenso: baseWeight * calibrationFactor, clampado a MAX_WITNESS_WEIGHT. */
  weight: number;
  /** Peso base configurado por el operador (default 1.0). */
  baseWeight: number;
  /** Factor de calibracion A.4.4 aplicado (1.0 sin datos; ~0.1..~1.9 con datos). */
  calibrationFactor: number;
}

export type SubjectStatus =
  | 'consistent'
  | 'head_mismatch'
  | 'equivocation'
  | 'backdated_entry'
  | 'subject_chain_unverified'
  | 'no_observations';

export interface SubjectIndexEntry {
  subjectDid: string;
  domain: string;
  status: SubjectStatus;
  /** Longitud de la cadena del sujeto al momento del sync (null si no verifico). */
  length: number | null;
  head: string | null;
  observations: IndexObservation[];
  findings: WitnessFinding[];
  /** Head con mas peso entre las observaciones de la ultima seq vista; weight = suma de pesos de esa cabeza. */
  consensus: { seq: number; head: string | null; weight: number } | null;
  witnessesUsed: string[];
  witnessesSkipped: WitnessSkip[];
  syncedAt: string;
}

export interface SyncWitnessIndexInput {
  siteId: string;
  /** Dominio del sujeto a indexar (sin esquema). */
  domain: string;
  /** Dominios de los testigos a consultar. */
  witnesses: string[];
  /** Peso por DID de testigo (did:apw:<dominio>); se persiste antes de sincronizar. */
  weights?: Record<string, number>;
}

const COMPACT_JWS_RE = /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/;

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/[.]$/, '');
  return domain.length > 0 ? domain : null;
}

function decodeJsonPart(jws: string, index: number): any {
  const part = jws.split('.')[index];
  const base64 = part.split('-').join('+').split('_').join('/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
}

function decodeHeaderKid(jws: string): string | null {
  try {
    const header = decodeJsonPart(jws, 0);
    return typeof header?.kid === 'string' ? header.kid : null;
  } catch {
    return null;
  }
}

function chainViewFrom(history: ApwHistoryResult): Array<{ seq: number; hash: string; ts: string }> | null {
  if (!history.verified || !history.attestations) return null;
  const view: Array<{ seq: number; hash: string; ts: string }> = [];
  for (const ref of history.attestations) {
    if (typeof ref.entryHash !== 'string') return null;
    view.push({ seq: ref.seq, hash: ref.entryHash, ts: ref.ts });
  }
  return view;
}

/**
 * Consulta al testigo y devuelve las observaciones VERIFICADAS sobre el
 * sujeto. Un statement malo se saltea (lo reporta en skipped, con su
 * motivo); jamas se guarda algo que no verifique.
 */
export async function collectWitnessStatements(
  deps: IndexDeps,
  input: { subjectDid: string; witnessDomain: string }
): Promise<{ observations: Array<Omit<IndexObservation, 'weight'>>; skipped: WitnessSkip[]; witnessOk: boolean }> {
  const { subjectDid, witnessDomain } = input;
  const observations: Array<Omit<IndexObservation, 'weight'>> = [];
  const skipped: WitnessSkip[] = [];
  const skip = (reason: string) => skipped.push({ witnessDomain, reason });

  const witnessHistory = await deps.resolveHistory(witnessDomain);
  if (!witnessHistory.verified) {
    skip('witness_chain_unverified');
    return { observations, skipped, witnessOk: false };
  }
  const witnessDid = `did:apw:${witnessHistory.domain}`;
  const refs = new Map<number, ChainAttestationRef>();
  for (const ref of witnessHistory.attestations ?? []) refs.set(ref.seq, ref);

  let witnessOk = false;
  let from = 1;
  for (let page = 0; page < MAX_WITNESS_PAGES; page++) {
    const text = await deps.fetchText(`https://${witnessHistory.domain}/.well-known/apw-witnesses.json?from=${from}&limit=${WITNESS_PAGE_LIMIT}`);
    if (text === null) {
      skip(page === 0 ? 'witness_endpoint_unreachable' : 'witness_endpoint_truncated');
      return { observations, skipped, witnessOk };
    }
    let doc: any;
    try {
      doc = JSON.parse(text);
    } catch {
      skip('witness_endpoint_invalid');
      return { observations, skipped, witnessOk };
    }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
      skip('witness_endpoint_invalid');
      return { observations, skipped, witnessOk };
    }
    if (doc.did !== witnessDid) {
      skip('witness_did_mismatch');
      return { observations, skipped, witnessOk };
    }
    witnessOk = true;

    for (const entry of doc.entries) {
      // Barato primero: solo los statements sobre ESTE sujeto pasan a crypto.
      if (entry?.witness?.sub !== subjectDid) continue;
      const ref = refs.get(Number(entry.seq));
      if (!ref) {
        skip('statement_not_anchored');
        continue;
      }
      if (typeof entry.jws !== 'string' || !COMPACT_JWS_RE.test(entry.jws)) {
        skip('statement_malformed');
        continue;
      }
      if (ref.att !== (await sha256B64Url(entry.jws))) {
        skip('statement_att_mismatch');
        continue;
      }
      const kid = decodeHeaderKid(entry.jws);
      const keys = witnessHistory.keys ?? [];
      const key = kid ? keys.find((k) => k.keyId === kid) ?? keys.find((k) => k.kid === kid) : undefined;
      if (!kid || !key) {
        skip('statement_unknown_key');
        continue;
      }
      const verified = await verifyWitnessStatement(entry.jws, key.publicKeyJwk, {
        kid,
        expectedIss: witnessDid,
        expectedSub: subjectDid,
      });
      if (!verified.ok) {
        skip(`statement_invalid:${verified.reason}`);
        continue;
      }
      const payload = verified.payload;
      if (payload.iss === subjectDid) {
        skip('self_witness');
        continue;
      }
      observations.push({
        witnessDid: payload.iss,
        seq: payload.seq,
        head: payload.head,
        anchoredTs: ref.ts,
        jti: payload.jti,
      });
    }

    const next = Number(doc.next);
    if (!Number.isInteger(next) || next < 1) break;
    from = next;
  }

  return { observations, skipped, witnessOk };
}

function statusFromFindings(findings: WitnessFinding[], hasObservations: boolean): SubjectStatus {
  if (findings.some((f) => f.type === 'equivocation')) return 'equivocation';
  if (findings.some((f) => f.type === 'head_mismatch')) return 'head_mismatch';
  if (findings.some((f) => f.type === 'backdated_entry')) return 'backdated_entry';
  return hasObservations ? 'consistent' : 'no_observations';
}

function consensusOf(observations: readonly IndexObservation[]): SubjectIndexEntry['consensus'] {
  if (observations.length === 0) return null;
  const topSeq = Math.max(...observations.map((o) => o.seq));
  const byHead = new Map<string, { head: string | null; weight: number }>();
  for (const obs of observations) {
    if (obs.seq !== topSeq) continue;
    const key = obs.head ?? '';
    const slot = byHead.get(key) ?? { head: obs.head, weight: 0 };
    slot.weight += obs.weight;
    byHead.set(key, slot);
  }
  const ranked = [...byHead.values()].sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : String(a.head) < String(b.head) ? -1 : 1));
  return { seq: topSeq, head: ranked[0].head, weight: ranked[0].weight };
}

/**
 * Calibracion de pesos estilo A.4.4 adaptada al Index: un testigo que
 * coincide con el consenso gana factor y uno que disiente lo pierde. La
 * tasa de acuerdo se estima con el suavizado de Laplace (acuerdos+1 sobre
 * total+2), que arranca en 1.0 sin datos; el factor lineal va de 0.1
 * (nunca coincide) a 1.9 (siempre coincide). Los pesos no se castigan sin
 * datos: un testigo sin observacion en la seq del consenso no cuenta.
 */
export function witnessCalibrationFactor(agree: number, disagree: number): number {
  const a = Math.max(0, agree);
  const d = Math.max(0, disagree);
  return 0.1 + 1.8 * ((a + 1) / (a + d + 2));
}

/**
 * Sincroniza UN sujeto: baja los statements de cada testigo configurado, los
 * verifica, upsertea las observaciones ancladas, evalua contra la cadena
 * actual del sujeto y guarda la entrada de directorio resultante.
 */
export async function syncWitnessIndex(deps: IndexDeps, store: WitnessIndexStore, input: SyncWitnessIndexInput): Promise<SubjectIndexEntry> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('invalid_domain');
  const subjectDid = `did:apw:${domain}`;
  const witnesses = [...new Set(input.witnesses.map((w) => normalizeDomain(w)).filter((w): w is string => w !== null))];

  if (input.weights) {
    for (const [did, weight] of Object.entries(input.weights)) {
      assertWitnessWeight(weight);
      if (!did.startsWith('did:apw:') || did.length <= 'did:apw:'.length) throw new Error('invalid_witness_did');
      await store.setWeight(input.siteId, did, weight);
    }
  }

  const witnessesUsed: string[] = [];
  const witnessesSkipped: WitnessSkip[] = [];
  const nowIso = (deps.now?.() ?? new Date()).toISOString();

  for (const witnessDomain of witnesses) {
    const result = await collectWitnessStatements(deps, { subjectDid, witnessDomain });
    if (result.witnessOk) witnessesUsed.push(`did:apw:${witnessDomain}`);
    witnessesSkipped.push(...result.skipped);
    for (const obs of result.observations) {
      await store.upsertObservation({
        siteId: input.siteId,
        subjectDid,
        witnessDid: obs.witnessDid,
        observedSeq: obs.seq,
        observedHead: obs.head,
        anchoredTs: obs.anchoredTs,
        statementJti: obs.jti,
        updatedAt: nowIso,
      });
    }
  }

  const weights = await store.getWeights(input.siteId);
  const calibration = await store.getCalibration(input.siteId);
  const records = await store.listObservations(input.siteId, subjectDid);
  const observations: IndexObservation[] = records.map((rec: WitnessObservationRecord) => {
    const baseWeight = weights[rec.witnessDid] ?? 1;
    const counts = calibration[rec.witnessDid] ?? { agree: 0, disagree: 0 };
    const factor = witnessCalibrationFactor(counts.agree, counts.disagree);
    return {
      witnessDid: rec.witnessDid,
      seq: rec.observedSeq,
      head: rec.observedHead,
      anchoredTs: rec.anchoredTs,
      jti: rec.statementJti,
      baseWeight,
      calibrationFactor: factor,
      weight: Math.min(MAX_WITNESS_WEIGHT, baseWeight * factor),
    };
  });

  const consensus = consensusOf(observations);

  // Calibracion (A.4.4): cada testigo con observacion en la seq del
  // consenso suma un acuerdo o un desacuerdo; sin observacion en esa seq
  // no se lo castiga ni premia (no hay datos).
  if (consensus) {
    const topSeq = consensus.seq;
    const counted = new Set<string>();
    for (const obs of observations) {
      if (obs.seq !== topSeq || counted.has(obs.witnessDid)) continue;
      counted.add(obs.witnessDid);
      await store.recordCalibration(input.siteId, obs.witnessDid, obs.head === consensus.head);
    }
  }

  const subjectHistory = await deps.resolveHistory(domain);
  const chainView = chainViewFrom(subjectHistory);
  let status: SubjectStatus;
  let findings: WitnessFinding[] = [];
  let length: number | null = null;
  let head: string | null = null;

  if (!chainView) {
    status = 'subject_chain_unverified';
  } else {
    findings =
      chainView.length > 0 || observations.length > 0 ? evaluateWitnesses(observations, chainView).findings : [];
    status = statusFromFindings(findings, observations.length > 0);
    length = subjectHistory.length ?? chainView.length;
    head = subjectHistory.head ?? null;
  }

  const entry: SubjectIndexEntry = {
    subjectDid,
    domain,
    status,
    length,
    head,
    observations,
    findings,
    consensus,
    witnessesUsed,
    witnessesSkipped,
    syncedAt: nowIso,
  };
  await store.saveSubjectEntry({ siteId: input.siteId, subjectDid, domain, entryJson: JSON.stringify(entry), updatedAt: nowIso });
  return entry;
}

/** Documento publico del indice (JSON plano; cada entrada es re-verificable contra las cadenas). */
export interface IndexDocument {
  typ: typeof INDEX_DOC_TYP;
  /** did:apw del nodo indice que publica. */
  iss: string;
  generatedAt: string;
  subjects: SubjectIndexEntry[];
}

export function buildIndexDocument(subjects: SubjectIndexEntry[], meta: { indexDid: string; generatedAt: string }): IndexDocument {
  return { typ: INDEX_DOC_TYP, iss: meta.indexDid, generatedAt: meta.generatedAt, subjects };
}

/** Parsea una entrada cacheada; una fila corrupta se ignora (direccion segura: no publicar). */
export function parseSubjectEntry(entryJson: unknown): SubjectIndexEntry | null {
  if (typeof entryJson !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(entryJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.subjectDid !== 'string' || typeof parsed.domain !== 'string' || typeof parsed.status !== 'string') return null;
  if (!Array.isArray(parsed.observations) || !Array.isArray(parsed.findings)) return null;
  return parsed as SubjectIndexEntry;
}

// ---------------------------------------------------------------------------
// Sincronizacion entre nodos (Phase 5). El apw-index.json de un par NO se
// importa: se usa como descubrimiento de (sujeto, testigos) y cada entrada
// se re-sincroniza con el MISMO pipeline fail-closed que un sync manual
// (cadena del testigo -> statements anclados -> firma -> jti). Un par
// malicioso solo puede lograr que este nodo verifique cadenas reales; nunca
// inyecta observaciones sin verificar.
// ---------------------------------------------------------------------------

/** Sujetos maximos leidos del documento de UN par por sync. */
export const MAX_PEER_SUBJECTS = 50;
/** Testigos maximos tomados del witnessesUsed de una entrada del par. */
export const MAX_PEER_WITNESSES = 20;

export type PeerSyncOutcome = PeerSyncStatus | 'self_peer';

export interface PeerSyncSubjectReport {
  domain: string;
  /** 'synced' si el pipeline completo corrio; si no, el motivo del skip. */
  result: 'synced' | 'no_witnesses' | 'invalid_subject' | string;
  status?: SubjectStatus;
}

export interface PeerSyncReport {
  peerDomain: string;
  outcome: PeerSyncOutcome;
  peerDid: string | null;
  subjectsSynced: number;
  subjectsSkipped: number;
  subjects: PeerSyncSubjectReport[];
}

export interface SyncIndexPeersInput {
  siteId: string;
  /** Pares a sincronizar; null = todos los configurados en el store. */
  peers?: string[];
  /** Dominio propio (did:apw:<dominio> de este nodo): un par que apunte a uno mismo se saltea. */
  ownDomain?: string;
  maxSubjectsPerPeer?: number;
}

export async function syncIndexPeers(deps: IndexDeps, store: WitnessIndexStore, input: SyncIndexPeersInput): Promise<{ peers: PeerSyncReport[]; subjectsSynced: number }> {
  const configured = await store.listPeers(input.siteId);
  const requested = input.peers?.map((p) => normalizeDomain(p)).filter((p): p is string => p !== null) ?? null;
  const targets = requested ? configured.filter((p) => requested.includes(p.peerDomain)) : configured;
  const own = input.ownDomain ? normalizeDomain(input.ownDomain) : null;
  const maxSubjects = Math.min(MAX_PEER_SUBJECTS, Math.max(1, input.maxSubjectsPerPeer ?? MAX_PEER_SUBJECTS));
  const reports: PeerSyncReport[] = [];
  let subjectsSynced = 0;

  for (const peer of targets) {
    const report: PeerSyncReport = {
      peerDomain: peer.peerDomain,
      outcome: 'peer_unreachable',
      peerDid: null,
      subjectsSynced: 0,
      subjectsSkipped: 0,
      subjects: [],
    };

    if (own && peer.peerDomain === own) {
      report.outcome = 'self_peer';
      reports.push(report);
      continue;
    }

    const text = await deps.fetchText(`https://${peer.peerDomain}/.well-known/apw-index.json`);
    if (text === null) {
      report.outcome = 'peer_unreachable';
      await store.updatePeerStatus(input.siteId, peer.peerDomain, 'peer_unreachable', 0, null);
      reports.push(report);
      continue;
    }

    let doc: any;
    try {
      doc = JSON.parse(text);
    } catch {
      doc = null;
    }
    if (
      !doc ||
      typeof doc !== 'object' ||
      doc.typ !== INDEX_DOC_TYP ||
      typeof doc.iss !== 'string' ||
      !doc.iss.startsWith('did:apw:') ||
      doc.iss.length <= 'did:apw:'.length ||
      !Array.isArray(doc.subjects)
    ) {
      report.outcome = 'peer_invalid';
      await store.updatePeerStatus(input.siteId, peer.peerDomain, 'peer_invalid', 0, null);
      reports.push(report);
      continue;
    }

    report.outcome = 'ok';
    report.peerDid = doc.iss;

    for (const subject of doc.subjects.slice(0, maxSubjects)) {
      const domain = subject?.domain !== undefined ? normalizeDomain(subject.domain) : null;
      const rawWitnesses = Array.isArray(subject?.witnessesUsed) ? subject.witnessesUsed : [];
      // El directorio publica witnessesUsed como DIDs (did:apw:<dominio>);
      // para re-sincronizar necesitamos el hostname.
      const witnesses = [
        ...new Set(
          rawWitnesses
            .map((w: unknown) => {
              if (typeof w !== 'string') return null;
              return normalizeDomain(w.startsWith('did:apw:') ? w.slice('did:apw:'.length) : w);
            })
            .filter((w): w is string => w !== null)
        ),
      ].slice(0, MAX_PEER_WITNESSES);
      if (!domain) {
        report.subjectsSkipped += 1;
        report.subjects.push({ domain: String(subject?.domain ?? ''), result: 'invalid_subject' });
        continue;
      }
      if (witnesses.length === 0) {
        report.subjectsSkipped += 1;
        report.subjects.push({ domain, result: 'no_witnesses' });
        continue;
      }
      try {
        const entry = await syncWitnessIndex(deps, store, { siteId: input.siteId, domain, witnesses });
        report.subjectsSynced += 1;
        subjectsSynced += 1;
        report.subjects.push({ domain, result: 'synced', status: entry.status });
      } catch (err) {
        report.subjectsSkipped += 1;
        report.subjects.push({ domain, result: `sync_failed:${String((err as Error)?.message ?? 'unknown')}` });
      }
    }

    await store.updatePeerStatus(input.siteId, peer.peerDomain, 'ok', report.subjectsSynced, report.peerDid);
    reports.push(report);
  }

  return { peers: reports, subjectsSynced };
}
