import {
  OperationBudget,
  OperationBudgetError,
  type HttpResponseBudget,
} from "@portaless/net";
import { APPROVED_LIMITS, type LtpLimits, type LtpLocalReason } from "./types";

export type { HttpResponseBudget };

export class LtpFailure extends Error {
  constructor(public readonly reason: LtpLocalReason, message: string, public readonly stage?: string) {
    super(message);
    this.name = "LtpFailure";
  }
}

export function assertWithinApprovedLimits(limits: LtpLimits): void {
  for (const [key, ceiling] of Object.entries(APPROVED_LIMITS) as Array<[keyof LtpLimits, number]>) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) throw new LtpFailure("unsupported_profile", `invalid limit: ${key}`);
    if (value > ceiling) throw new LtpFailure("unsupported_profile", `limit above approved ceiling: ${key}`);
  }
}

function wrapBudgetError(error: unknown): never {
  if (error instanceof OperationBudgetError) {
    throw new LtpFailure(error.code, error.message, error.stage);
  }
  throw error;
}

/**
 * Per-operation accounting for one composed resolution, backed by `@portaless/net`.
 */
export class ResourceBudget {
  private readonly inner: OperationBudget<LtpLimits>;

  constructor(public readonly limits: LtpLimits, now: () => number) {
    assertWithinApprovedLimits(limits);
    this.inner = new OperationBudget(limits, now);
  }

  get httpAttemptsUsed(): number {
    return this.inner.httpAttemptsUsed;
  }

  get bodyBytesUsed(): number {
    return this.inner.bodyBytesUsed;
  }

  get signatureAttemptsUsed(): number {
    return this.inner.signatureAttemptsUsed;
  }

  elapsedMs(): number {
    return this.inner.elapsedMs();
  }

  checkDeadline(stage: string): void {
    try {
      this.inner.checkDeadline(stage);
    } catch (error) {
      wrapBudgetError(error);
    }
  }

  reserveHttp(byteCap: number, stage: string): HttpResponseBudget {
    try {
      const reservation = this.inner.reserveHttp(byteCap, stage);
      return {
        settle: (actualBytes: number) => {
          try {
            reservation.settle(actualBytes);
          } catch (error) {
            wrapBudgetError(error);
          }
        },
      };
    } catch (error) {
      wrapBudgetError(error);
    }
  }

  reserveSignature(stage: string): void {
    try {
      this.inner.reserveSignature(stage);
    } catch (error) {
      wrapBudgetError(error);
    }
  }
}
