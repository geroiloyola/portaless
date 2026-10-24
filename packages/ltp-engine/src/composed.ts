import canonicalize from "canonicalize";
import { ResourceBudget } from "./budget";
import { acquireIdentity, acquisitionFailureResult, type AcquisitionInput, type AcquisitionOutcome } from "./acquisition";
import { verifyHandoff, type VerificationInput } from "./verification";
import type { ComposedResult, DeclaredSlice, LtpHandoff, PrefixState } from "./types";

export interface ComposedInput extends AcquisitionInput {
  states: { initial: PrefixState; slices: DeclaredSlice[] };
  /** Separate deterministic clock for B, after A has stopped measuring hops. */
  verificationNow?: () => number;
  wallAt?: (elapsedMs: number) => number;
}

export interface ComposedOutcome {
  result: ComposedResult;
  handoff: LtpHandoff | null;
  acquisition: AcquisitionOutcome;
  budget: ResourceBudget;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

/** Executes A acquisition and B offline verification in memory with one shared budget. */
export async function runComposed(input: ComposedInput): Promise<ComposedOutcome> {
  const budget = new ResourceBudget(input.config.limits, input.now);
  const acquisition = await acquireIdentity({ ...input, budget });
  if (!acquisition.ok) {
    return { result: acquisitionFailureResult(acquisition, budget), handoff: null, acquisition, budget };
  }
  const verificationInput: VerificationInput = {
    handoff: acquisition.handoff,
    budget,
    policy: input.policy,
    states: input.states,
    now: input.verificationNow ?? input.now,
    wallAt: input.wallAt,
    acquisitionConsumed: acquisition.consumed,
  };
  const verification = verifyHandoff(verificationInput);
  return { result: verification.result, handoff: acquisition.handoff, acquisition, budget };
}

export { sameValue };
