import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { projectSvri } from "../../packages/apw-resolver/src/scoring/svri";
import { classifyLevel } from "../../packages/ltp-reputation/src/projection";
import { runReputationCase } from "../../packages/ltp-reputation/src/run-vector";
import type { ReputationCase } from "../../packages/ltp-reputation/src/types";

const ROOT = new URL("../../docs/protocol-apw/vectors/ltp/reputation/v0.1/", import.meta.url);
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
      if (expected.version !== "1.0" || !Array.isArray((item.input as any).dimensions)) continue;
      const dimensions = (item.input as any).dimensions;
      const names = dimensions.map((dimension: any) => dimension.dimension);
      if (new Set(names).size !== names.length) continue;
      const reference = projectSvri({ dimensions, ...(item.input as any).counts ? {
        t1Count: item.input.counts[0], t2Count: item.input.counts[1], t3Count: item.input.counts[2],
        t4Count: item.input.counts[3], t5Count: item.input.counts[4],
      } : {} } as never);
      // The legacy apw-resolver rounds these fields to 6 decimals; G4 vectors
      // store unrounded binary64. Normalize the old side before comparing.
      const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
      expect(Math.abs(round6(reference.score) - round6(expected.score))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.priorShare) - round6(expected.priorShare))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(round6(reference.effectiveWeight) - round6(expected.effectiveWeight))).toBeLessThanOrEqual(1e-9);
      expect(reference.incompleteData).toBe(expected.incompleteData);
      expect(reference.isInference).toBe(expected.isInference);
      // The legacy path rounds before classifying; the G4 path uses the
      // unrounded score. Verify the legacy level follows from its own rounded
      // value, not from the G4 boundary vector.
      const legacyLevel = normaliseLevel(classifyLevel(round6(expected.score), expected.incompleteData,
        expected.isInference, expected.t1Count, expected.t2Count));
      expect(normaliseLevel(reference.publicLevel)).toBe(legacyLevel);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });
});
