import { describe, expect, it } from "vitest";
import { getPublicSvriLevel } from "../../src/lib/svri-public-level";

const measured = { incompleteData: false, isInference: false, t1Count: 1, t2Count: 0 };

describe("SVRI public classification", () => {
  it.each([
    [4.99, "low"],
    [5, "verify"],
    [6.99, "verify"],
    [7, "safe"],
    [8.9, "safe"],
    [9, "reliable"],
    [10, "reliable"],
  ] as const)("score %s maps to %s without early rounding", (score, level) => {
    expect(getPublicSvriLevel({ ...measured, score }).id).toBe(level);
  });

  it("fails closed to Pendiente when evidence is incomplete even if the internal score is high", () => {
    expect(getPublicSvriLevel({ score: 9.5, incompleteData: true, isInference: true, t1Count: 0, t2Count: 0 }).id).toBe("pending");
  });

  it("requires primary evidence for Confiable and flags inference as Verificar", () => {
    expect(getPublicSvriLevel({ score: 9.5, incompleteData: false, isInference: false, t1Count: 0, t2Count: 0 }).id).toBe("pending");
    expect(getPublicSvriLevel({ score: 9.5, incompleteData: false, isInference: true, t1Count: 1, t2Count: 0 }).id).toBe("verify");
  });

  it("unknown public level is Pendiente", () => {
    expect(getPublicSvriLevel({ publicLevel: "unknown" as never }).id).toBe("pending");
    expect(getPublicSvriLevel({ score: 11, incompleteData: false, isInference: false, t1Count: 1, t2Count: 0 }).id).toBe("pending");
  });
});
