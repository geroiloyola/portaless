import { APPROVED_LIMITS, type LtpLimits, type LtpLocalReason } from "./types";

export class LtpFailure extends Error {
  constructor(public readonly reason: LtpLocalReason, message: string, public readonly stage?: string) {
    super(message);
    this.name = "LtpFailure";
  }
}

export interface HttpResponseBudget {
  settle(actualBytes: number): void;
}

export function assertWithinApprovedLimits(limits: LtpLimits): void {
  for (const [key, ceiling] of Object.entries(APPROVED_LIMITS) as Array<[keyof LtpLimits, number]>) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) throw new LtpFailure("unsupported_profile", `invalid limit: ${key}`);
    if (value > ceiling) throw new LtpFailure("unsupported_profile", `limit above approved ceiling: ${key}`);
  }
}

/**
 * Per-operation accounting for one composed resolution. It reserves before I/O,
 * charges actual body bytes after the response, counts failed signature attempts,
 * and enforces one shared exclusive deadline. No retry or deadline reset exists.
 */
export class ResourceBudget {
  httpAttemptsUsed = 0;
  bodyBytesUsed = 0;
  signatureAttemptsUsed = 0;

  constructor(public readonly limits: LtpLimits, private readonly now: () => number) {
    assertWithinApprovedLimits(limits);
  }

  elapsedMs(): number {
    return this.now();
  }

  checkDeadline(stage: string): void {
    if (!Number.isFinite(this.elapsedMs()) || this.elapsedMs() < 0) {
      throw new LtpFailure("deadline_exceeded", "invalid monotonic clock", stage);
    }
    if (this.elapsedMs() >= this.limits.deadlineMs) {
      throw new LtpFailure("deadline_exceeded", "shared operation deadline exceeded", stage);
    }
  }

  reserveHttp(byteCap: number, stage: string): HttpResponseBudget {
    this.checkDeadline(stage);
    if (this.httpAttemptsUsed >= this.limits.httpAttempts) {
      throw new LtpFailure("budget_exhausted", "http attempt limit reached", stage);
    }
    if (!Number.isSafeInteger(byteCap) || byteCap <= 0) {
      throw new LtpFailure("response_limit_exceeded", "invalid body allowance", stage);
    }
    if (this.bodyBytesUsed + byteCap > this.limits.bodyBytes) {
      throw new LtpFailure("response_limit_exceeded", "composed body allowance reached", stage);
    }
    this.httpAttemptsUsed += 1;
    // Conservative pre-charge: a failed/timeout attempt keeps the full
    // reservation. Only a completed response refunds the unused allowance.
    this.bodyBytesUsed += byteCap;
    let settled = false;
    return {
      settle: (actualBytes: number) => {
        if (settled) throw new Error("http reservation settled twice");
        settled = true;
        if (!Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > byteCap) {
          throw new LtpFailure("response_limit_exceeded", "response exceeds its pre-reserved cap", stage);
        }
        this.bodyBytesUsed -= byteCap - actualBytes;
      },
    };
  }

  reserveSignature(stage: string): void {
    this.checkDeadline(stage);
    if (this.signatureAttemptsUsed >= this.limits.signatureAttempts) {
      throw new LtpFailure("budget_exhausted", "signature attempt limit reached", stage);
    }
    // A failed verification consumes an attempt too; never refund it.
    this.signatureAttemptsUsed += 1;
  }
}
