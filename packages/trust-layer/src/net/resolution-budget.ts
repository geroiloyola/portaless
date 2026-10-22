import type { SafeFetchLimits, SafeFetchResult, SafeFetcher } from "../../../apw-resolver/src/federation/safe-fetch";
import { normalizeDirectoryOrigin } from "../webbotauth/directory-fetch";

export const RESOLUTION_STAGES = ["directory", "txt_doh", "did", "history", "evidence"] as const;
export type ResolutionStage = typeof RESOLUTION_STAGES[number];
export interface ResolutionContext {
  /** HMAC bucket from trusted ingress, never a raw IP or claimed DID. */
  clientBucket: string;
  /** Root directory origin being resolved, not a shared DoH provider's origin. */
  directoryOrigin: string;
  stage: ResolutionStage;
}
interface Quota { attempts: number; bytes: number }
export interface ResolutionBudgetOptions {
  windowMs: number;
  client: Quota;
  origin: Quota;
  maxBuckets: number;
}
export const RESOLUTION_BUDGET_PROPOSAL: ResolutionBudgetOptions = {
  windowMs: 60_000, client: { attempts: 20, bytes: 8 * 1024 * 1024 },
  origin: { attempts: 8, bytes: 4 * 1024 * 1024 }, maxBuckets: 4096,
};
export type BudgetRejection = {
  ok: false;
  error: "client_budget_exhausted" | "origin_budget_exhausted" | "budget_state_full";
  status: 429 | 503;
  retryAfterSeconds: number;
};
interface Bucket { window: number; attempts: number; bytes: number }

/**
 * PR2 kernel only: not imported by middleware or the production resolver.
 * Fixed-window, per-process atomic reservations; no claim of a shared Workers
 * quota. Distributed store/adapters and production activation remain gated.
 */
export class ResolutionBudget {
  private buckets = new Map<string, Bucket>();
  private options: ResolutionBudgetOptions;
  constructor(options: ResolutionBudgetOptions = RESOLUTION_BUDGET_PROPOSAL, private now: () => number = Date.now) {
    this.options = { ...options, client: { ...options.client }, origin: { ...options.origin } };
    const numbers = [options.windowMs, options.maxBuckets, options.client.attempts, options.client.bytes, options.origin.attempts, options.origin.bytes];
    if (numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) || options.maxBuckets < 2) throw new Error("invalid_resolution_budget");
  }

  stateForTests() { return [...this.buckets].map(([key, value]) => ({ key, ...value })); }

  async fetch(context: ResolutionContext, url: string, fetcher: SafeFetcher, limits: SafeFetchLimits = {}): Promise<SafeFetchResult | BudgetRejection> {
    if (!RESOLUTION_STAGES.includes(context.stage) || !/^(?:unknown|[a-f0-9]{64})$/.test(context.clientBucket)) throw new Error("invalid_resolution_context");
    const origin = normalizeDirectoryOrigin(context.directoryOrigin);
    if (!origin.startsWith("https://")) throw new Error("invalid_resolution_origin");
    const cap = limits.maxBytes ?? 512 * 1024;
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error("invalid_resolution_byte_cap");
    const window = Math.floor(this.now() / this.options.windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(((window + 1) * this.options.windowMs - this.now()) / 1000));
    const clientKey = `client:${context.clientBucket}`;
    const originKey = `origin:${origin}`;
    // Never evict active buckets to make room: that would reset attacker quotas.
    for (const [key, value] of this.buckets) if (value.window !== window) this.buckets.delete(key);
    const newKeys = Number(!this.buckets.has(clientKey)) + Number(!this.buckets.has(originKey));
    if (this.buckets.size + newKeys > this.options.maxBuckets) {
      return { ok: false, error: "budget_state_full", status: 503, retryAfterSeconds };
    }
    const client = this.buckets.get(clientKey) ?? { window, attempts: 0, bytes: 0 };
    const operator = this.buckets.get(originKey) ?? { window, attempts: 0, bytes: 0 };
    if (client.attempts >= this.options.client.attempts || client.bytes + cap > this.options.client.bytes) {
      return { ok: false, error: "client_budget_exhausted", status: 429, retryAfterSeconds };
    }
    if (operator.attempts >= this.options.origin.attempts || operator.bytes + cap > this.options.origin.bytes) {
      return { ok: false, error: "origin_budget_exhausted", status: 503, retryAfterSeconds };
    }
    // Reserve both scopes synchronously before the first await. Failed attempts
    // keep their charge; success refunds unused body allowance only.
    client.attempts++; client.bytes += cap;
    operator.attempts++; operator.bytes += cap;
    this.buckets.set(clientKey, client);
    this.buckets.set(originKey, operator);
    try {
      const result = await fetcher(url, { ...limits, maxBytes: cap, maxRedirects: 0 });
      // Redirects must return to the budgeted adapter as separate admitted hops.
      if (result.ok) {
        const bytes = new TextEncoder().encode(result.text ?? "").byteLength;
        if (bytes > cap) return { ok: false, error: "too_large" };
        client.bytes -= cap - bytes;
        operator.bytes -= cap - bytes;
      }
      return result;
    } catch {
      return { ok: false, error: "network_error" };
    }
  }
}

export interface TrustedClientContext {
  runtime: "node" | "cloudflare";
  trustedCloudflareIngress?: boolean;
  secret?: string;
  now?: number;
}

/** Call only with server-controlled context; headers cannot select trust mode. */
export async function resolutionClientBucket(request: Request, context: TrustedClientContext): Promise<string> {
  if (context.runtime !== "node" && context.runtime !== "cloudflare") return "unknown";
  if (!context.secret || context.secret.length < 32) return "unknown";
  if (context.runtime === "cloudflare" && !context.trustedCloudflareIngress) return "unknown";
  const ip = request.headers.get(context.runtime === "node" ? "x-portaless-client-ip" : "CF-Connecting-IP")?.trim();
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return "unknown";
  let canonical: string;
  try {
    const url = new URL(`https://${ip.includes(":") ? `[${ip}]` : ip}/`);
    if (!ip.includes(":") && !/^\d+(\.\d+){3}$/.test(url.hostname)) return "unknown";
    canonical = url.hostname;
  } catch { return "unknown"; }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(context.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const day = Math.floor((context.now ?? Date.now()) / 86_400_000);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${day}|${canonical}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
