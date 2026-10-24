import type { SvriCounts, SvriDimension, SvriProjection } from "./types";

export const TOLERANCE = 1e-9;
export const PRIOR_WEIGHT = 3;
export const NEUTRAL = 4;

export class DuplicateSvriDimensionError extends Error {
  readonly code = "duplicate_dimension";
  constructor(public readonly dimension: string) {
    super(`duplicate SVRI dimension: ${dimension}`);
    this.name = "DuplicateSvriDimensionError";
  }
}

export function issuerWeight(j: number): number {
  if (!Number.isFinite(j)) throw new Error("issuer weight requires a finite J");
  const clamped = Math.min(7, Math.max(1, j));
  return ((clamped - 1) / 6) ** 2;
}

export function classifyLevel(score: number, incompleteData: boolean, isInference: boolean, t1: number, t2: number): SvriProjection["publicLevel"] {
  if (!Number.isFinite(score) || score < 0 || score > 10 || incompleteData || t1 + t2 === 0) return "pending";
  if (score < 5) return "low";
  if (score < 7 || isInference) return "verify";
  if (score < 9) return "safe";
  return "trusted";
}

/**
 * G4 projection. Unlike the legacy apw-resolver helper, this exposes the
 * unrounded binary64 values committed by REP-07/REP-08. Ordering/tolerance
 * rules are applied by consumers, not by mutating the stored score.
 */
export function projectSvri(dimensions: readonly SvriDimension[], counts: SvriCounts): SvriProjection {
  if (!Array.isArray(counts) || counts.length !== 5
    || counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("invalid SVRI tier counts");
  }
  if (!Array.isArray(dimensions)) throw new Error("invalid SVRI dimensions");
  const [t1, t2, t3, t4, t5] = counts;
  const seen = new Set<string>();
  for (const item of dimensions) {
    if (!item || typeof item.dimension !== "string" || item.dimension.length === 0) {
      throw new Error("empty SVRI dimension");
    }
    if (seen.has(item.dimension)) throw new DuplicateSvriDimensionError(item.dimension);
    seen.add(item.dimension);
    if (!Number.isFinite(item.score) || item.score < 1 || item.score > 7
      || !Number.isFinite(item.weightSum) || item.weightSum < 0
      || !Number.isSafeInteger(item.count) || item.count < 0) {
      throw new Error(`invalid SVRI dimension: ${item.dimension}`);
    }
  }
  // Zero-weight or zero-count dimensions are protocol priors, not evidence.
  const measured = dimensions.filter(item => item.count > 0 && item.weightSum > 0);
  const score10 = measured.map(item => (10 * (item.score - 1)) / 6);
  const score = score10.length === 0 ? 5 : score10.reduce((sum, value) => sum + value, 0) / score10.length;
  const effectiveWeight = measured.reduce((sum, item) => sum + item.weightSum, 0);
  const dimensionCount = measured.length;
  const priorShare = dimensionCount === 0 ? 1 : (PRIOR_WEIGHT * dimensionCount) / (PRIOR_WEIGHT * dimensionCount + effectiveWeight);
  const isInference = priorShare > 0.5;
  const incompleteData = t1 + t2 === 0;
  return {
    version: "1.0",
    profile: "ltp-svri-site-v1",
    score,
    t1Count: t1,
    t2Count: t2,
    t3Count: t3,
    t4Count: t4,
    t5Count: t5,
    incompleteData,
    isInference,
    priorShare,
    effectiveWeight,
    dimensionCount,
    publicLevel: classifyLevel(score, incompleteData, isInference, t1, t2),
  };
}

export function withinTolerance(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

export function endpointScore10(): { score10: number[]; mean: number } {
  return { score10: [0, 10], mean: 5 };
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderEntries(entries: Array<{ subject: string; score: number; weightSum: number; count: number }>): string[] {
  for (const entry of entries) {
    if (typeof entry.subject !== "string" || !Number.isFinite(entry.score)
      || !Number.isFinite(entry.weightSum) || !Number.isSafeInteger(entry.count)) {
      throw new Error("invalid reputation ordering entry");
    }
  }
  return [...entries]
    .sort((left, right) => right.score - left.score || right.weightSum - left.weightSum
      || right.count - left.count || compareCodePoints(left.subject, right.subject))
    .map(entry => entry.subject);
}

export function denominatorBits(denominators: readonly number[]): number {
  let value = 1n;
  for (const denominator of denominators) {
    if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new Error("invalid denominator");
    value = lcm(value, BigInt(denominator));
  }
  const binary = value.toString(2);
  return binary.length;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcm(left: bigint, right: bigint): bigint {
  return (left / gcd(left, right)) * right;
}
