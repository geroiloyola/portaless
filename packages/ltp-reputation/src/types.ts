export interface SvriDimension {
  dimension: string;
  score: number;
  count: number;
  weightSum: number;
}

export type SvriCounts = [number, number, number, number, number];

export interface SvriProjection {
  version: "1.0";
  profile: "ltp-svri-site-v1";
  score: number;
  t1Count: number;
  t2Count: number;
  t3Count: number;
  t4Count: number;
  t5Count: number;
  incompleteData: boolean;
  isInference: boolean;
  priorShare: number;
  effectiveWeight: number;
  dimensionCount: number;
  publicLevel: "pending" | "low" | "verify" | "safe" | "trusted";
}

export interface ReputationCase {
  id: string;
  kind: string;
  description: string;
  input: Record<string, any>;
  expected: Record<string, any>;
}
