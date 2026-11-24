import {
  RESOLUTION_BUDGET_PROPOSAL,
  RESOLUTION_STAGES,
  ResolutionBudget,
  __resetResolutionHmacDayForTests,
  hashClientIpBuckets,
  normalizeResolutionOrigin,
} from "@portaless/net";

export {
  RESOLUTION_BUDGET_PROPOSAL,
  RESOLUTION_STAGES,
  ResolutionBudget,
  __resetResolutionHmacDayForTests,
  normalizeResolutionOrigin,
};
export type {
  BudgetRejection,
  ResolutionBudgetOptions,
  ResolutionContext,
  ResolutionStage,
} from "@portaless/net";

export interface TrustedClientContext {
  runtime: "node" | "cloudflare";
  trustedCloudflareIngress?: boolean;
  secret?: string;
  previousSecret?: string;
  now?: number;
}

/**
 * Portaless ingress adapter: extracts the runtime-trusted client IP header and
 * delegates rotating HMAC bucketing to neutral `@portaless/net`.
 * Call only with server-controlled context; headers cannot select trust mode.
 */
export async function resolutionClientBuckets(
  request: Request,
  context: TrustedClientContext,
): Promise<string[]> {
  if (context.runtime !== "node" && context.runtime !== "cloudflare") return ["unknown"];
  if (context.runtime === "cloudflare" && !context.trustedCloudflareIngress) return ["unknown"];
  const ip = request.headers
    .get(context.runtime === "node" ? "x-portaless-client-ip" : "CF-Connecting-IP")
    ?.trim();
  return hashClientIpBuckets(ip, {
    secret: context.secret,
    previousSecret: context.previousSecret,
    now: context.now,
  });
}

export async function resolutionClientBucket(
  request: Request,
  context: TrustedClientContext,
): Promise<string> {
  return (await resolutionClientBuckets(request, context))[0];
}
