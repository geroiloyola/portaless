/**
 * Dimensiones W de un sitio calculadas desde su SiteTrustSnapshot
 * (LTP Anexo A.2 y A.4), para la proyeccion del 6.6 / A.6.
 *
 * Funciones puras: sin I/O, sin reloj, deterministas. Reciben el snapshot
 * ya cargado (4 fuentes del SiteTrustScore) y devuelven los mismos
 * DimensionScore que produce el motor del Anexo A para los lectores (R).
 *
 * Mapeo (A.2): cada categoria de una fuente cae en una dimension; el valor
 * sale de A.4.1 (booleana 7/1, community 1..5 -> 1..7, nativas 1..7).
 * Las categorias que A.2 no mapea (`community.perceived_trustworthiness`,
 * las categorias `self` de W-08, que todavia no existen) no alimentan
 * ninguna dimension: sus filas siguen siendo publicas como dato crudo, pero
 * no entran a la puntuacion. Ver ERRATA E-11.
 *
 * Senales que este modulo NO incorpora (y por que):
 *   - Los pesos intra-dimension de A.2 (60/40, 50/50...): A.4.3 puntua con
 *     el peso del emisor (A.4.2), no con el peso de la senal. El motor
 *     normativo no los usa tampoco.
 *   - W-07 "antiguedad del historial APW": A.4.1 no define como llevar una
 *     antiguedad a la escala 1..7. W-07 puntua con `agent.content_freshness`.
 *   - W-09 exige comparar `self` contra terceros **en la misma dimension**
 *     (A.5): hoy solo W-03 y W-05 tienen ambos lados, porque ninguna
 *     categoria se repite entre fuentes.
 *
 * Calibracion (A.4.4): los emisores se calibran con las filas del propio
 * sitio (el store no lista todos los sitios). Sin atestaciones comparables
 * J = 4.0 y w = 0.25, que es exactamente la regla de A.4.4.
 *
 * El lado R no entra aqui: scoreSubject() inyecta R-05 neutral y el snapshot
 * no tiene filas `reader_conduct`. La proyeccion publica es solo W.
 */

import {
  attestationWeight,
  bayesianScore,
  calibrateJudges,
  scoreSubject,
  toValue,
  type DimensionScore,
  type ScoredAttestation,
} from './scoring';
import { communityPredicate, emitterAgeOk, latestPerEmitter, type CommunityRow } from './community';

export const SITE_SUBJECT_PREFIX = 'did:apw:';

/** A.2: categoria de cada fuente -> dimension. Lo que no esta aqui no puntua. */
export const CATEGORY_DIMENSION: Readonly<Record<string, string>> = {
  // agent
  https_and_headers: 'W-01',
  bot_traffic_anomalies: 'W-01',
  structured_data_quality: 'W-06',
  machine_readable_policies: 'W-06',
  content_freshness: 'W-07',
  // self
  privacy_policy: 'W-04',
  gdpr_compliance: 'W-04',
  data_practices: 'W-04',
  contact_transparency: 'W-03',
  terms_of_service: 'W-03',
  payment_security: 'W-05',
  // community
  content_accuracy: 'W-02',
  responsiveness: 'W-03',
  spam_or_deceptive: 'W-10',
};

/** W-02/03/05/08/10 gobernados; W-01/04/06/07/09 publicos (A.6). */
export function isSiteDimension(dimension: string): boolean {
  return /^W-(0[1-9]|10)$/.test(dimension);
}

/**
 * A.4.1, escala nativa 1..7 para el resultado de una transaccion
 * (`cat` = transactionOutcome, `val` siempre true en 5.3): completada 7.0,
 * reembolsada sin entrega 2.5 (por debajo de neutral, como un voto 2 de 5),
 * en disputa 1.0. Devuelve null si el resultado no esta en el modelo.
 */
export function escrowOutcomeValue(outcome: string): number | null {
  switch (outcome) {
    case 'completed_as_promised': return 7;
    case 'refunded_no_delivery': return 2.5;
    case 'disputed': return 1;
    default: return null;
  }
}

export interface SiteSnapshotLike {
  siteId: string;
  /** Optional canonical DID (the storage siteId may be an internal key such as `default`). */
  siteDid?: string;
  self?: ReadonlyArray<{
    category: string;
    declaredValue: boolean;
    attestationJti?: string;
    declaredBy?: string;
    declaredAt?: string;
    attestationJws?: string;
  }>;
  agent?: ReadonlyArray<{
    category: string;
    verified: boolean;
    agentKeyId: string;
    verifiedAt: string;
    attestationJti?: string;
    attestationJws?: string;
  }>;
  community?: ReadonlyArray<{
    category: string;
    score: number;
    /** Opinion de visitante (legacy). Sin `iss` no puntua: no tiene identidad. */
    voterId?: string;
    /** `did:apw` del emisor (el Veracier). Presente solo en atestaciones firmadas. */
    iss?: string;
    jti?: string;
    attestationJws?: string;
    /** `iat` de la atestacion, en segundos. */
    iat?: number;
    votedAt: string;
    /** Primera entrada verificada del historial del emisor (E-13); null/ausente no acredita. */
    emitterFirstSeenIat?: number | null;
  }>;
  escrowReports?: ReadonlyArray<{
    transactionOutcome: string;
    escrowProvider: string;
    reportedAt: string;
    attestationJti?: string;
    attestationJws?: string;
  }>;
}

export function siteSubject(siteId: string): string {
  return `${SITE_SUBJECT_PREFIX}${siteId}`;
}

/**
 * A.4.1 sobre un valor de fila: si el campo no esta, no es booleano o esta
 * fuera de escala (filas legacy o corruptas), la fila no puntua. No se
 * lanza: una fila que no entra al modelo no puede tumbar la proyeccion de
 * una respuesta; la fila cruda igual viaja en el snapshot.
 */
function rowValue(input: unknown, scale: 'boolean' | 'community'): number | null {
  try {
    return toValue(input as boolean | number, scale);
  } catch {
    return null;
  }
}

/**
 * Filas del snapshot -> atestaciones ya normalizadas (1..7) con la
 * dimension de A.2. `sub` es el DID del sitio (5.3); `iss` es quien genera
 * el dato. Las categorias fuera del modelo se descartan: no hay dimension
 * donde ponerlas.
 */
/**
 * Filas comunitarias FIRMADAS, agrupadas por categoria y ya filtradas (E-13).
 *
 * Una fila sin `iss` es una opinion de visitante del modelo anterior: no tiene
 * identidad verificable, asi que NO puntua. De las que si la tienen se toma la
 * ultima por emisor (reemitir reemplaza) y se descartan los emisores que no
 * acreditan el minimo de antiguedad de historial. El `min_weight` NO se aplica
 * aca: necesita la calibracion, y esa se calcula en `scoreSiteDimensions`.
 */
export function attestedCommunityRows(snapshot: SiteSnapshotLike): Map<string, CommunityRow[]> {
  const grouped = new Map<string, CommunityRow[]>();
  for (const row of snapshot.community ?? []) {
    if (typeof row.iss !== 'string' || !row.iss) continue;
    if (!CATEGORY_DIMENSION[row.category]) continue;
    if (rowValue(row.score, 'community') === null) continue;
    if (typeof row.iat !== 'number' || !Number.isFinite(row.iat)) continue;
    const list = grouped.get(row.category) ?? [];
    list.push({
      iss: row.iss,
      category: row.category,
      val: row.score,
      iat: row.iat,
      jti: row.jti ?? `${row.iss}:${row.category}:${row.iat}`,
      emitterFirstSeenIat: row.emitterFirstSeenIat ?? null,
    });
    grouped.set(row.category, list);
  }

  const out = new Map<string, CommunityRow[]>();
  for (const [category, rows] of grouped) {
    out.set(
      category,
      latestPerEmitter(rows).filter((r) => emitterAgeOk(r.iat, r.emitterFirstSeenIat))
    );
  }
  return out;
}

function communityRowsToAttestations(
  rowsByCategory: ReadonlyMap<string, CommunityRow[]>,
  sub: string
): ScoredAttestation[] {
  const out: ScoredAttestation[] = [];
  for (const rows of rowsByCategory.values()) {
    for (const row of rows) {
      const dimension = CATEGORY_DIMENSION[row.category];
      const value = rowValue(row.val, 'community');
      if (!dimension || value === null) continue;
      out.push({ id: row.jti, iss: row.iss, sub, src: 'community', dimension, value, category: row.category });
    }
  }
  return out;
}

export function snapshotToAttestations(snapshot: SiteSnapshotLike): ScoredAttestation[] {
  const sub = siteSubject(snapshot.siteId);
  const out: ScoredAttestation[] = [];

  for (const row of snapshot.self ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const value = rowValue(row.declaredValue, 'boolean');
    if (!dimension || value === null) continue;
    out.push({
      id: row.attestationJti ?? `self:${sub}:${row.category}`,
      iss: sub,
      sub,
      src: 'self',
      dimension,
      value,
    });
  }

  for (const row of snapshot.agent ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const value = rowValue(row.verified, 'boolean');
    if (!dimension || value === null) continue;
    out.push({
      id: row.attestationJti ?? `agent:${row.agentKeyId}:${row.category}:${row.verifiedAt}`,
      iss: row.agentKeyId,
      sub,
      src: 'agent',
      dimension,
      value,
    });
  }

  // Community (E-13): solo atestaciones firmadas. Las filas sin `iss` son
  // opinion de visitante del modelo anterior y no puntuan; deduplicacion y
  // antiguedad ya vienen aplicadas. El `min_weight` se aplica en
  // scoreSiteDimensions, que es quien tiene la calibracion.
  for (const attestation of communityRowsToAttestations(attestedCommunityRows(snapshot), sub)) {
    out.push(attestation);
  }

  for (const row of snapshot.escrowReports ?? []) {
    const value = escrowOutcomeValue(row.transactionOutcome);
    if (value === null) continue;
    out.push({
      id: row.attestationJti ?? `escrow:${row.escrowProvider}:${row.reportedAt}`,
      iss: row.escrowProvider,
      sub,
      src: 'escrow_report',
      dimension: 'W-05',
      value,
    });
  }

  return out;
}

/**
 * A.5, indice de coherencia (W-09): por cada dimension con `self` y con
 * terceros, 7 - |media declarada - media verificada| (misma escala 1..7;
 * a mayor divergencia, menor coherencia). Cada comparacion entra al mismo
 * promedio bayesiano de A.4.3 con el peso total de la evidencia que la
 * sostiene. Sin ninguna dimension comparable no hay W-09.
 */
function coherenceScore(
  attestations: ReadonlyArray<ScoredAttestation>,
  judges: ReadonlyMap<string, number>,
): DimensionScore | null {
  const groups = new Map<string, { self: number[]; others: number[]; weight: number }>();
  for (const a of attestations) {
    if (a.dimension === 'W-09' || !isSiteDimension(a.dimension)) continue;
    const g = groups.get(a.dimension) ?? { self: [], others: [], weight: 0 };
    (a.src === 'self' ? g.self : g.others).push(a.value);
    g.weight += attestationWeight(a, judges);
    groups.set(a.dimension, g);
  }

  const items: Array<{ weight: number; value: number }> = [];
  for (const g of groups.values()) {
    if (!g.self.length || !g.others.length) continue;
    const diff = Math.abs(mean(g.self) - mean(g.others));
    items.push({ weight: g.weight, value: Math.min(7, Math.max(1, 7 - diff)) });
  }
  if (!items.length) return null;
  return { ...bayesianScore(items), dimension: 'W-09' };
}

/**
 * Puntajes W del sitio: A.4 sobre las filas del snapshot + W-09 derivado.
 * Devuelve solo dimensiones W con evidencia (sin filas no hay entrada:
 * una dimension sin datos no es 4.0, es "sin datos", igual que en
 * projectTrustView). R-05 (neutral, inyectado por scoreSubject) se quita.
 */
export function scoreSiteDimensions(snapshot: SiteSnapshotLike): Map<string, DimensionScore> {
  const sub = siteSubject(snapshot.siteId);

  // Pasada 1: se calibra con TODO lo que hay, sin el gate de `min_weight`,
  // porque los pesos que decide el gate salen justamente de la calibracion.
  const ungated = snapshotToAttestations(snapshot);
  const preJudges = calibrateJudges(ungated);

  // Gate de E-13: `min_weight` POR (sujeto, categoria). Una categoria que no
  // junta 2.0 de peso entre emisores distintos no puntua; las demas fuentes
  // que comparten su dimension (W-03 recibe `self` y `community`) quedan
  // intactas.
  const rowsByCategory = attestedCommunityRows(snapshot);
  const surviving = new Map<string, CommunityRow[]>();
  let gatedAny = false;
  for (const [category, rows] of rowsByCategory) {
    const predicate = communityPredicate(rows, preJudges);
    if (predicate.passes) surviving.set(category, predicate.rows);
    else gatedAny = true;
  }

  const attestations = gatedAny
    ? [...ungated.filter((a) => a.src !== 'community'), ...communityRowsToAttestations(surviving, sub)]
    : ungated;
  const judges = gatedAny ? calibrateJudges(attestations) : preJudges;

  const scores = scoreSubject(sub, attestations, judges);

  const coherence = coherenceScore(attestations, judges);
  if (coherence) scores.set('W-09', coherence);

  for (const dimension of [...scores.keys()]) {
    if (!isSiteDimension(dimension)) scores.delete(dimension);
  }
  return scores;
}

function mean(values: ReadonlyArray<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}
