/**
 * Motor de puntuacion por dimensiones (LTP v1.2, Anexo A).
 * Funciones puras: sin I/O, sin reloj, deterministas. Recibe atestaciones ya verificadas (5.3).
 */

export const NEUTRAL = 4.0;
export const PRIOR_WEIGHT = 3; // P (A.4.3)
export const SELF_WEIGHT = 0.25; // A.4.2
export const DEVIATION_PENALTY = 1.5; // J = max(1, 7 - 1.5 * dbar)
export const CALIBRATION_ROUNDS = 8;

export type Source = 'self' | 'agent' | 'community' | 'escrow_report' | 'reader_conduct';

export interface ScoredAttestation {
  /** jti o id estable de la atestacion */
  id: string;
  iss: string;
  sub: string;
  src: Source;
  dimension: string;
  /** valor ya llevado a 1.0..7.0 con toValue() */
  value: number;
}

export interface DimensionScore {
  dimension: string;
  score: number;
  count: number;
  weightSum: number;
}

export function issuerWeight(j: number): number {
  const c = clamp(j, 1, 7);
  return ((c - 1) / 6) ** 2;
}

export function judgeFromDeviation(meanAbsDeviation: number | null): number {
  if (meanAbsDeviation === null) return NEUTRAL;
  return Math.max(1, 7 - DEVIATION_PENALTY * meanAbsDeviation);
}

/** A.4.1: booleanas -> 7/1; community 1..5 -> 1..7 lineal; numericas ya en 1..7. */
export function toValue(input: boolean | number, scale: 'boolean' | 'community' | 'native'): number {
  if (scale === 'boolean') {
    if (typeof input !== 'boolean') throw new TypeError('se esperaba booleano');
    return input ? 7 : 1;
  }
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new TypeError('se esperaba numero finito');
  if (scale === 'community') {
    if (input < 1 || input > 5) throw new RangeError('voto community fuera de 1..5');
    return 1 + ((input - 1) * 6) / 4;
  }
  if (input < 1 || input > 7) throw new RangeError('valor fuera de 1..7');
  return input;
}

/** reader_conduct (6.4) -> dimension R y valor. redistribution/policy_violation con val:true son negativas. */
export function readerConductToDimension(cat: string, val: boolean): { dimension: string; value: number } {
  switch (cat) {
    case 'respected_policy': return { dimension: 'R-01', value: val ? 7 : 1 };
    case 'policy_violation': return { dimension: 'R-01', value: val ? 1 : 7 };
    case 'rate_respected': return { dimension: 'R-02', value: val ? 7 : 1 };
    case 'paid_as_agreed': return { dimension: 'R-03', value: val ? 7 : 1 };
    case 'redistribution': return { dimension: 'R-04', value: val ? 1 : 7 };
    default: throw new RangeError(`categoria reader_conduct desconocida: ${cat}`);
  }
}

/** A.4.3: S = (P*4 + sum(w*v)) / (P + sum(w)) */
export function bayesianScore(items: ReadonlyArray<{ weight: number; value: number }>): DimensionScore {
  let ws = 0;
  let wv = 0;
  for (const { weight, value } of items) {
    ws += weight;
    wv += weight * value;
  }
  return {
    dimension: '',
    score: (PRIOR_WEIGHT * NEUTRAL + wv) / (PRIOR_WEIGHT + ws),
    count: items.length,
    weightSum: ws,
  };
}

function weightOf(a: ScoredAttestation, judges: ReadonlyMap<string, number>): number {
  if (a.src === 'self') return SELF_WEIGHT;
  return issuerWeight(judges.get(a.iss) ?? NEUTRAL);
}

const key = (sub: string, dim: string) => `${sub}\u0000${dim}`;

/**
 * Calibracion R-05 (A.4.3) por punto fijo: cada emisor se compara contra el consenso de la
 * dimension evaluada calculado sin su propia atestacion (leave-one-out). self no alimenta R-05.
 * Una atestacion de un emisor sobre si mismo tampoco cuenta para su calibracion.
 * El consenso de calibracion es el promedio ponderado de los demas emisores, sin previo P (ERRATA E-7).
 */
export function calibrateJudges(
  attestations: ReadonlyArray<ScoredAttestation>,
  rounds = CALIBRATION_ROUNDS,
): Map<string, number> {
  const groups = new Map<string, ScoredAttestation[]>();
  for (const a of attestations) {
    const k = key(a.sub, a.dimension);
    const g = groups.get(k);
    if (g) g.push(a); else groups.set(k, [a]);
  }

  let judges = new Map<string, number>();
  for (let r = 0; r < rounds; r++) {
    const devSum = new Map<string, number>();
    const devCount = new Map<string, number>();
    for (const group of groups.values()) {
      let ws = 0;
      let wv = 0;
      const weights = group.map((a) => weightOf(a, judges));
      group.forEach((a, i) => { ws += weights[i]; wv += weights[i] * a.value; });
      group.forEach((a, i) => {
        if (a.src === 'self' || a.iss === a.sub) return;
        const others = ws - weights[i];
        if (others <= 1e-12) return;
        // Sin previo: P tiraria el consenso a 4.0 y castigaria al evaluador honesto (ERRATA E-7).
        const loo = (wv - weights[i] * a.value) / others;
        devSum.set(a.iss, (devSum.get(a.iss) ?? 0) + Math.abs(a.value - loo));
        devCount.set(a.iss, (devCount.get(a.iss) ?? 0) + 1);
      });
    }
    const next = new Map<string, number>();
    for (const [iss, n] of devCount) next.set(iss, judgeFromDeviation(devSum.get(iss)! / n));
    judges = next;
  }
  return judges;
}

/** Puntajes de todas las dimensiones de un sujeto. R-05 del sujeto sale de la calibracion. */
export function scoreSubject(
  subject: string,
  attestations: ReadonlyArray<ScoredAttestation>,
  judges: ReadonlyMap<string, number> = calibrateJudges(attestations),
): Map<string, DimensionScore> {
  const byDim = new Map<string, Array<{ weight: number; value: number }>>();
  for (const a of attestations) {
    if (a.sub !== subject || a.dimension === 'R-05') continue;
    const list = byDim.get(a.dimension) ?? [];
    list.push({ weight: weightOf(a, judges), value: a.value });
    byDim.set(a.dimension, list);
  }
  const out = new Map<string, DimensionScore>();
  for (const [dimension, items] of byDim) out.set(dimension, { ...bayesianScore(items), dimension });

  const j = judges.get(subject);
  let n = 0;
  for (const a of attestations) if (a.iss === subject && a.src !== 'self' && a.iss !== a.sub) n++;
  out.set('R-05', { dimension: 'R-05', score: j ?? NEUTRAL, count: n, weightSum: j === undefined ? 0 : n });
  return out;
}

export function scoreOf(scores: ReadonlyMap<string, DimensionScore>, dimension: string): DimensionScore {
  return scores.get(dimension) ?? { dimension, score: NEUTRAL, count: 0, weightSum: 0 };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
