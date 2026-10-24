import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { projectSvri } from "../../packages/apw-resolver/src/scoring/svri";
import { classifyLevel, orderEntries, projectSvri as projectG4Svri, withinTolerance } from "../../packages/ltp-reputation/src/projection";
import { runReputationCase } from "../../packages/ltp-reputation/src/run-vector";
import type { ReputationCase } from "../../packages/ltp-reputation/src/types";

const ROOT = new URL("../../docs/protocol-apw/vectors/ltp/reputation/v0.1/", import.meta.url);
const SVRI_MATH = new URL("../../docs/protocol-apw/vectors/ltp/v0.1/svri-math.json", import.meta.url);
const FILES = [
  "rep-01-issuer.json", "rep-02-attestation.json", "rep-03-uniqueness.json",
  "rep-04-eligibility.json", "rep-05-reader-conduct.json", "rep-06-negatives.json",
  "rep-07-no-data.json", "rep-08-boundaries.json", "rep-09-caps.json",
  "rep-10-hsvr.json", "rep-11-differential.json",
];

function cases(): Array<{ family: string; item: ReputationCase }> {
  return FILES.flatMap(file => {
    const family = JSON.parse(readFileSync(new URL(file, ROOT), "utf8"));
    return family.cases.map((item: ReputationCase) => ({ family: family.family, item }));
  });
}

function normaliseLevel(level: string): string {
  return level === "reliable" ? "trusted" : level;
}

describe("G4 static REP-01…REP-11 corpus", () => {
  test("the immutable corpus contains 117 unique cases across 11 families", () => {
    const all = cases();
    expect(all).toHaveLength(117);
    expect(new Set(all.map(entry => entry.item.id)).size).toBe(117);
    expect(new Set(all.map(entry => entry.family)).size).toBe(11);
  });

  test("the TypeScript engine matches every literal expected object", () => {
    for (const { item } of cases()) {
      expect(runReputationCase(item), item.id).toEqual(item.expected);
    }
  });

  test("projection cases agree with the existing apw-resolver implementation within 1e-9", () => {
    let compared = 0;
    for (const { item } of cases()) {
      const expected = item.expected as Record<string, any>;
      const projection = expected.version === "1.0" ? expected : expected.projection;
      if (projection?.version !== "1.0" || !Array.isArray((item.input as any).dimensions)) continue;
      const dimensions = (item.input as any).dimensions;
      const reference = projectSvri({ dimensions, ...(item.input as any).counts ? {
        t1Count: item.input.counts[0], t2Count: item.input.counts[1], t3Count: item.input.counts[2],
        t4Count: item.input.counts[3], t5Count: item.input.counts[4],
      } : {} } as never);
      // The legacy apw-resolver rounds these fields to 6 decimals; G4 vectors
      // store unrounded binary64. Normalize the old side before comparing.
      const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
      expect(Math.abs(round6(reference.score) - round6(projection.score))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.priorShare) - round6(projection.priorShare))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.effectiveWeight) - round6(projection.effectiveWeight))).toBeLessThanOrEqual(1e-9);
      expect(reference.incompleteData).toBe(projection.incompleteData);
      expect(reference.isInference).toBe(projection.isInference);
      // The legacy path rounds before classifying; the G4 path uses the
      // unrounded score. Verify the legacy level follows from its own rounded
      // value, not from the G4 boundary vector.
      const legacyLevel = normaliseLevel(classifyLevel(round6(projection.score), projection.incompleteData,
        projection.isInference, projection.t1Count, projection.t2Count));
      expect(normaliseLevel(reference.publicLevel)).toBe(legacyLevel);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  test("duplicate dimensions are rejected by the engine, oracle and apw-resolver", () => {
    for (const id of ["REP-11-02", "REP-11-05"]) {
      const entry = cases().find(({ item }) => item.id === id);
      expect(entry).toBeDefined();
      expect(runReputationCase(entry!.item)).toEqual({ error: "duplicate_dimension", dimension: "W-05" });
      expect(() => projectSvri({
        dimensions: entry!.item.input.dimensions,
        t1Count: 1, t2Count: 0, t3Count: 0, t4Count: 0, t5Count: 0,
      } as never)).toThrow(/duplicate or empty LTP dimension/);
    }
    expect(() => projectG4Svri([
      { dimension: "W-05", score: 4, count: 1, weightSum: 3 },
      { dimension: "W-05", score: 7, count: 1, weightSum: 3 },
    ], [1, 0, 0, 0, 0])).toThrow(/duplicate SVRI dimension/);
  });

  test("every svri-math projection is reproduced by both implementations", () => {
    const family = JSON.parse(readFileSync(SVRI_MATH, "utf8"));
    const fraction = (value: string): number => {
      const [numerator, denominator = "1"] = value.split("/");
      return Number(numerator) / Number(denominator);
    };
    for (const item of family.cases) {
      const dimensions = item.input.dimensions.map((dimension: any, index: number) => {
        const weightSum = fraction(dimension.weight);
        const weightedValue = fraction(dimension.weightedValue);
        return {
          dimension: `W-MATH-${index + 1}`,
          score: (12 + weightedValue) / (3 + weightSum),
          count: 1,
          weightSum,
        };
      });
      const counts = item.input.counts;
      const candidate = projectG4Svri(dimensions, counts);
      const reference = projectSvri({
        dimensions,
        t1Count: counts[0], t2Count: counts[1], t3Count: counts[2], t4Count: counts[3], t5Count: counts[4],
      });
      const expected = item.expected;
      expect(withinTolerance(candidate.score, expected.projection.score), item.id).toBe(true);
      expect(withinTolerance(candidate.priorShare, expected.projection.priorShare), item.id).toBe(true);
      expect(withinTolerance(candidate.effectiveWeight, expected.projection.effectiveWeight), item.id).toBe(true);
      expect(candidate.incompleteData, item.id).toBe(expected.projection.incompleteData);
      expect(candidate.isInference, item.id).toBe(expected.projection.isInference);
      expect(normaliseLevel(candidate.publicLevel), item.id).toBe(expected.publicLevel);
      // The legacy implementation rounds to 6 decimals before returning.
      const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
      expect(Math.abs(round6(reference.score) - round6(expected.projection.score)), item.id).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.priorShare) - round6(expected.projection.priorShare)), item.id).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.effectiveWeight) - round6(expected.projection.effectiveWeight)), item.id).toBeLessThanOrEqual(1e-9);
      // The legacy path rounds before classifying; G4 classifies the unrounded
      // value. At 4.999999999999762 that is an intentional level difference.
      const legacyLevel = normaliseLevel(classifyLevel(round6(reference.score),
        reference.incompleteData, reference.isInference, reference.t1Count, reference.t2Count));
      expect(normaliseLevel(reference.publicLevel), item.id).toBe(legacyLevel);
    }
  });

  test("empty, unknown or incomplete decision inputs fail closed", () => {
    const base = { id: "adversarial", description: "missing evidence" };
    expect(() => runReputationCase({ ...base, kind: "issuerEligibility", input: {} })).toThrow(/evidence facts/);
    expect(() => runReputationCase({ ...base, kind: "attestationIntegrity", input: {} })).toThrow(/evidence facts/);
    expect(() => runReputationCase({ ...base, kind: "hsvrProvenance", input: {} })).toThrow(/evidence facts/);
    expect(() => runReputationCase({ ...base, kind: "attestationIntegrity", input: { trustedByCaller: true } })).toThrow(/does not accept/);
    expect(() => runReputationCase({ ...base, kind: "issuerEligibility", input: { chain: true } })).toThrow(/requires keyTs/);
  });

  test("zero-weight dimensions are priors and do not enter the mean or denominator", () => {
    const projection = projectG4Svri([
      { dimension: "W-05", score: 7, count: 0, weightSum: 0 },
      { dimension: "W-01", score: 4, count: 1, weightSum: 3 },
    ], [1, 0, 0, 0, 0]);
    expect(projection.score).toBe(5);
    expect(projection.dimensionCount).toBe(1);
    expect(projection.effectiveWeight).toBe(3);
    expect(projection.priorShare).toBe(0.5);
  });

  test("projection rejects invalid dimensions instead of emitting a neutral result", () => {
    expect(() => projectG4Svri([{ dimension: "W-05", score: Number.NaN, count: 1, weightSum: 3 }], [1, 0, 0, 0, 0]))
      .toThrow(/invalid SVRI dimension/);
    expect(() => projectG4Svri([{ dimension: "", score: 4, count: 1, weightSum: 3 }], [1, 0, 0, 0, 0]))
      .toThrow(/empty/);
    expect(() => projectG4Svri([
      { dimension: "W-05", score: 4, count: 1, weightSum: 3 },
      { dimension: "W-05", score: 7, count: 1, weightSum: 3 },
    ], [1, 0, 0, 0, 0])).toThrow(/duplicate SVRI dimension/);
  });

  test("ordering ties use locale-independent code-point order", () => {
    expect(orderEntries([
      { subject: "z", score: 5, weightSum: 3, count: 1 },
      { subject: "ä", score: 5, weightSum: 3, count: 1 },
    ])).toEqual(["z", "ä"]);
  });
});
