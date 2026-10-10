// packages/apw-resolver/src/did-apw/witness.ts
//
// Testigos externos (ERRATA E-10; APW v1.3, seccion 5.7). Un testigo es
// cualquier sitio con identidad did:apw que observa la cadena encadenada de
// OTRO sitio y publica un statement firmado con la cabeza que vio:
//
//   { typ: "apw-witness+jws", iss, sub, seq, head, ts, jti }
//
// El statement se anota en el historial ENCADENADO DEL PROPIO TESTIGO
// (appendAttestation), asi que su fecha creible es el ts de la entrada del
// historial del testigo (anclada por su `h` en el DNS), no el `ts` declarado
// en el payload. El endpoint /.well-known/apw-witnesses.json publica esos
// statements; el evaluador los cruza contra la cadena actual del sujeto.
//
// Que detecta (frente a la cadena actual del sujeto):
//   - head_mismatch  el sujeto reescribio o truncó la cadena: la observacion
//                    anclada de un head en seq ya no coincide.
//   - equivocation   dos testigos anclaron heads distintos para la misma seq.
//   - backdated_entry una entrada del sujeto con seq MAYOR que el head
//                    observado declara un ts anterior a cuando el testigo vio
//                    la cadena sin esa entrada (mas el margen de skew).
//
// Que NO detecta: omision desde el inicio (el sitio nunca anoto una
// atestacion que no le conviene) salvo que un testigo haya observado
// tambien al EMISOR de esa atestacion (comparacion entre emisor y lector,
// fuera del alcance de este nucleo). Un testigo malicioso puede inventar
// observaciones; su statements solo valen si la cadena DEL TESTIGO verifica
// (el evaluator solo acepta observaciones leidas de una cadena verificada).

import { sha256B64Url } from './history-log';
import { signSiteJws, verifySiteJws, type SiteSigningKey } from './site-jws';

export const WITNESS_TYP = 'apw-witness+jws';

const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const COMPACT_JWS_RE = /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/;

/** Margen aceptado al comparar fechas, en segundos (misma ventana que iat, E-4). */
export const WITNESS_BACKDATE_SKEW_SECONDS = 300;

export interface WitnessPayload {
  typ: typeof WITNESS_TYP;
  /** did:apw:<dominio del testigo> */
  iss: string;
  /** did:apw:<dominio observado> */
  sub: string;
  /** Longitud observada de la cadena del sujeto (0 si estaba vacia). */
  seq: number;
  /** Hash de la ultima entrada observada (null si seq = 0). */
  head: string | null;
  /** ISO 8601 UTC: cuando el testigo observo (declarado; la fecha creible es la del historial del testigo). */
  ts: string;
  /** wt-<base64url(sha256(iss|sub|seq|head))>: determinista, repetir la observacion no duplica. */
  jti: string;
}

export type WitnessInput = Pick<WitnessPayload, 'iss' | 'sub' | 'seq' | 'head' | 'ts'>;

export async function witnessJti(iss: string, sub: string, seq: number, head: string | null): Promise<string> {
  return `wt-${await sha256B64Url(`${iss}|${sub}|${seq}|${head ?? ''}`)}`;
}

export function isWitnessDid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('did:apw:') && value.length > 'did:apw:'.length;
}

/**
 * Arma el payload de un statement. Lanza invalid_input si seq no es entero
 * >= 0, si head no es null ni hash de 43 caracteres, si seq > 0 sin head, o
 * si seq = 0 con head.
 */
export async function buildWitnessPayload(input: WitnessInput): Promise<WitnessPayload> {
  const { iss, sub, seq, head, ts } = input;
  if (!isWitnessDid(iss) || !isWitnessDid(sub)) throw new Error('invalid_input');
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('invalid_input');
  if (head !== null && (typeof head !== 'string' || !HASH_RE.test(head))) throw new Error('invalid_input');
  if ((seq === 0) !== (head === null)) throw new Error('invalid_input');
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) throw new Error('invalid_input');
  return {
    typ: WITNESS_TYP,
    iss,
    sub,
    seq,
    head,
    ts,
    jti: await witnessJti(iss, sub, seq, head),
  };
}

/** Firma un statement con la clave del testigo. Devuelve el JWS y su payload. */
export async function signWitnessStatement(input: WitnessInput, key: SiteSigningKey): Promise<{ jws: string; payload: WitnessPayload }> {
  const payload = await buildWitnessPayload(input);
  const jws = await signSiteJws(payload as unknown as Record<string, unknown>, key, WITNESS_TYP);
  return { jws, payload };
}

export type WitnessStatementFailure =
  | 'malformed_statement'
  | 'invalid_typ'
  | 'invalid_claims'
  | 'jti_mismatch'
  | 'iss_mismatch'
  | 'sub_mismatch'
  | 'kid_mismatch'
  | 'bad_signature'
  | 'unsupported_key';

export type VerifyWitnessStatementResult =
  | { ok: true; payload: WitnessPayload }
  | { ok: false; reason: WitnessStatementFailure };

export interface WitnessExpectations {
  /** kid esperado del header (clave del testigo). */
  kid: string;
  expectedIss?: string;
  expectedSub?: string;
}

/**
 * Verifica un statement contra la clave publica del testigo. Nunca lanza.
 * Ademas de firma (verifySiteJws, E-5), revalida la forma del payload y
 * recomputa el jti determinista (E-10).
 */
export async function verifyWitnessStatement(
  jws: unknown,
  publicKeyJwk: JsonWebKey | null | undefined,
  expected: WitnessExpectations
): Promise<VerifyWitnessStatementResult> {
  const fail = (reason: WitnessStatementFailure): VerifyWitnessStatementResult => ({ ok: false, reason });
  if (typeof jws !== 'string' || !COMPACT_JWS_RE.test(jws)) return fail('malformed_statement');

  const site = await verifySiteJws(jws, publicKeyJwk, { kid: expected.kid, typ: WITNESS_TYP });
  if (!site.ok) {
    if (site.reason === 'invalid_typ') return fail('invalid_typ');
    if (site.reason === 'kid_mismatch') return fail('kid_mismatch');
    if (site.reason === 'unsupported_key') return fail('unsupported_key');
    if (site.reason === 'bad_signature') return fail('bad_signature');
    return fail('malformed_statement');
  }

  const p = site.payload as Partial<WitnessPayload>;
  if (
    p.typ !== WITNESS_TYP ||
    !isWitnessDid(p.iss) ||
    !isWitnessDid(p.sub) ||
    !Number.isSafeInteger(p.seq) ||
    (p.seq as number) < 0 ||
    typeof p.ts !== 'string' ||
    Number.isNaN(Date.parse(p.ts)) ||
    typeof p.jti !== 'string'
  ) {
    return fail('invalid_claims');
  }
  const head = p.head ?? null;
  if (head !== null && (typeof head !== 'string' || !HASH_RE.test(head))) return fail('invalid_claims');
  if (((p.seq as number) === 0) !== (head === null)) return fail('invalid_claims');

  if (expected.expectedIss !== undefined && p.iss !== expected.expectedIss) return fail('iss_mismatch');
  if (expected.expectedSub !== undefined && p.sub !== expected.expectedSub) return fail('sub_mismatch');
  if (p.jti !== (await witnessJti(p.iss, p.sub, p.seq as number, head))) return fail('jti_mismatch');

  return { ok: true, payload: p as WitnessPayload };
}

/** Observacion leida de una cadena VERIFICADA del testigo (apw-witnesses.json + apw-log.json del testigo). */
export interface WitnessObservation {
  witnessDid: string;
  seq: number;
  head: string | null;
  /** ts firmado de la entrada del historial DEL TESTIGO donde se anoto el statement: su ancla temporal creible. */
  anchoredTs: string;
}

/** Entrada de la cadena ACTUAL del sujeto, con su ts firmado. */
export interface ChainViewEntry {
  seq: number;
  hash: string;
  ts: string;
}

export type WitnessFindingType = 'head_mismatch' | 'equivocation' | 'backdated_entry';

export interface WitnessFinding {
  type: WitnessFindingType;
  /** Testigo(s) involucrado(s). En equivocation van los dos. */
  witnessDid?: string[];
  seq: number;
  /** En head_mismatch: el hash observado. En backdated_entry: el ts observado del testigo. En equivocation: los heads en conflicto. */
  observed?: string | null | Array<string | null>;
  /** En head_mismatch: el hash actual de la cadena. En backdated_entry: el ts declarado por la entrada. */
  actual?: string | null;
}

export interface EvaluateWitnessesResult {
  /** true si no hay ningun hallazgo: la cadena actual es consistente con todas las observaciones ancladas. */
  ok: boolean;
  findings: WitnessFinding[];
  observationsChecked: number;
}

/**
 * Cruza observaciones de testigos contra la cadena actual del sujeto.
 * La cadena debe venir verificada (verifyChain / resolveApwHistory); las
 * observaciones deben venir de cadenas de testigo verificadas. Sincrono:
 * no verifica firmas (eso lo hace verifyWitnessStatement al cargarlas).
 */
export function evaluateWitnesses(
  observations: readonly WitnessObservation[],
  chain: readonly ChainViewEntry[],
  opts: { skewSeconds?: number; nowMs?: number } = {}
): EvaluateWitnessesResult {
  const skew = (opts.skewSeconds ?? WITNESS_BACKDATE_SKEW_SECONDS) * 1000;
  const findings: WitnessFinding[] = [];
  const bySeq = new Map<number, ChainViewEntry>();
  for (const e of chain) bySeq.set(e.seq, e);

  // head_mismatch: la observacion anclada ya no coincide con la cadena actual.
  const headsSeen = new Map<number, Map<string, string[]>>();
  for (const obs of observations) {
    const current = bySeq.get(obs.seq);
    const currentHash = current?.hash ?? null;
    if (currentHash !== obs.head) {
      findings.push({
        type: 'head_mismatch',
        witnessDid: [obs.witnessDid],
        seq: obs.seq,
        observed: obs.head,
        actual: currentHash,
      });
    }
    let heads = headsSeen.get(obs.seq);
    if (!heads) { heads = new Map(); headsSeen.set(obs.seq, heads); }
    const key = obs.head ?? '';
    const list = heads.get(key) ?? [];
    list.push(obs.witnessDid);
    heads.set(key, list);
  }

  // equivocation: mismo seq, heads distintos entre observaciones.
  for (const [seq, heads] of headsSeen) {
    if (heads.size > 1) {
      findings.push({
        type: 'equivocation',
        witnessDid: [...heads.values()].flat(),
        seq,
        observed: [...heads.keys()].map((k) => (k === '' ? null : k)),
      });
    }
  }

  // backdated_entry: una entrada con seq > head observado declara un ts
  // anterior a cuando el testigo vio la cadena sin ella.
  for (const obs of observations) {
    const observedMs = Date.parse(obs.anchoredTs);
    if (Number.isNaN(observedMs)) continue;
    for (const entry of chain) {
      if (entry.seq <= obs.seq) continue;
      const entryMs = Date.parse(entry.ts);
      if (Number.isNaN(entryMs)) continue;
      if (entryMs < observedMs - skew) {
        findings.push({
          type: 'backdated_entry',
          witnessDid: [obs.witnessDid],
          seq: entry.seq,
          observed: obs.anchoredTs,
          actual: entry.ts,
        });
      }
    }
  }

  return { ok: findings.length === 0, findings, observationsChecked: observations.length };
}
