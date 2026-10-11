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
  self?: ReadonlyArray<{
    category: string;
    declaredValue: boolean;
    attestationJti?: string;
    declaredBy?: string;
    declaredAt?: string;
  }>;
  agent?: ReadonlyArray<{
    category: string;
    verified: boolean;
    agentKeyId: string;
    verifiedAt: string;
    attestationJti?: string;
  }>;
  community?: ReadonlyArray<{
    category: string;
    score: number;
    voterId: string;
    votedAt: string;
  }>;
  escrowReports?: ReadonlyArray<{
    transactionOutcome: string;
    escrowProvider: string;
    reportedAt: string;
    attestationJti?: string;
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

  for (const row of snapshot.community ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const value = rowValue(row.score, 'community');
    if (!dimension || value === null) continue;
    out.push({
      id: `${row.voterId}:${row.category}:${row.votedAt}`,
      iss: `community:${row.voterId}`,
      sub,
      src: 'community',
      dimension,
      value,
    });
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
  const attestations = snapshotToAttestations(snapshot);
  const judges = calibrateJudges(attestations);
  const scores = scoreSubject(siteSubject(snapshot.siteId), attestations, judges);

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
