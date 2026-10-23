import type { SafeFetchLimits, SafeFetchResult, SafeFetcher } from "../../../apw-resolver/src/federation/safe-fetch";
import { IdleBucketIndex } from "./idle-bucket-index";

export const RESOLUTION_STAGES = ["directory", "txt_doh", "did", "history", "evidence"] as const;
export type ResolutionStage = typeof RESOLUTION_STAGES[number];
export function normalizeResolutionOrigin(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.toLowerCase().replace(/[.]$/, "");
  return url.origin;
}
export interface ResolutionContext {
  /** Current/overlap HMAC buckets from trusted ingress, never a raw IP or claimed DID. */
  clientBucket: string | readonly string[];
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
  maxConcurrentTotal: number;
  maxConcurrentPerClient: number;
  maxConcurrentPerOrigin: number;
}
export const RESOLUTION_BUDGET_PROPOSAL: ResolutionBudgetOptions = {
  windowMs: 60_000, client: { attempts: 20, bytes: 8 * 1024 * 1024 },
  origin: { attempts: 8, bytes: 4 * 1024 * 1024 }, maxBuckets: 4096,
  maxConcurrentTotal: 8, maxConcurrentPerClient: 4, maxConcurrentPerOrigin: 4,
};
export type BudgetRejection = {
  ok: false;
  error: "client_budget_exhausted" | "origin_budget_exhausted" | "budget_state_full";
  status: 429 | 503;
  retryAfterSeconds: number;
};
interface Bucket { window: number; attempts: number; bytes: number; order: number; denied?: boolean }

/**
 * PR2 kernel: optionally injected by the Web Bot Auth directory adapter.
 * Fixed-window, per-process atomic reservations; no claim of a shared Workers
 * quota. Whole-chain adapters and cross-instance atomicity remain gated.
 */
export class ResolutionBudget {
  private buckets = new Map<string, Bucket>();
  private idle = new IdleBucketIndex();
  private window = -1;
  private sequence = 0;
  private activeClients = new Map<string, number>();
  private activeOrigins = new Map<string, number>();
  private activeTotal = 0;
  private options: ResolutionBudgetOptions;
  /** Inject elapsed monotonic milliseconds in tests, never a wall clock. */
  constructor(options: ResolutionBudgetOptions = RESOLUTION_BUDGET_PROPOSAL, private now: () => number = () => performance.now()) {
    this.options = { ...options, client: { ...options.client }, origin: { ...options.origin } };
    const numbers = [options.windowMs, options.maxBuckets, options.client.attempts, options.client.bytes, options.origin.attempts, options.origin.bytes,
      options.maxConcurrentTotal, options.maxConcurrentPerClient, options.maxConcurrentPerOrigin];
    if (numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) || options.maxBuckets < 2) throw new Error("invalid_resolution_budget");
  }

  stateForTests() {
    return { buckets: [...this.buckets].map(([key, value]) => ({ key, ...value })), activeTotal: this.activeTotal,
      activeClients: [...this.activeClients], activeOrigins: [...this.activeOrigins], idleEntries: this.idle.size };
  }

  private index(key: string, bucket: Bucket) {
    if (this.buckets.get(key) !== bucket) return; // completion from a previous window
    this.idle.remove(key);
    const quota = key.startsWith("client:") ? this.options.client : this.options.origin;
    if (bucket.denied || bucket.attempts >= quota.attempts || bucket.bytes >= quota.bytes
      || this.activeClients.has(key) || this.activeOrigins.has(key)) return;
    this.idle.set({ key, attempts: bucket.attempts, bytes: bucket.bytes, order: bucket.order });
  }

  async fetch(context: ResolutionContext, url: string, fetcher: SafeFetcher, limits: SafeFetchLimits = {}): Promise<SafeFetchResult | BudgetRejection> {
    const clientBuckets = [...new Set(Array.isArray(context.clientBucket) ? context.clientBucket : [context.clientBucket])];
    if (!RESOLUTION_STAGES.includes(context.stage) || !clientBuckets.length || clientBuckets.length > 2
      || clientBuckets.some((bucket) => !/^(?:unknown|[a-f0-9]{64})$/.test(bucket))) throw new Error("invalid_resolution_context");
    const origin = normalizeResolutionOrigin(context.directoryOrigin);
    if (!origin.startsWith("https://")) throw new Error("invalid_resolution_origin");
    const cap = limits.maxBytes ?? 512 * 1024;
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error("invalid_resolution_byte_cap");
    const timestamp = this.now();
    const window = Math.floor(timestamp / this.options.windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(((window + 1) * this.options.windowMs - timestamp) / 1000));
    const clientKeys = clientBuckets.map((bucket) => `client:${bucket}`);
    const originKey = `origin:${origin}`;
    // Whole-window replacement avoids a table scan on every admission. Old
    // in-flight references remain bounded by concurrency, with separate leases.
    if (window !== this.window) {
      this.buckets = new Map(); this.idle = new IdleBucketIndex(); this.window = window;
    }
    const newKeys = clientKeys.filter((key) => !this.buckets.has(key)).length + Number(!this.buckets.has(originKey));
    const clients = clientKeys.map((key) => this.buckets.get(key) ?? { window, attempts: 0, bytes: 0, order: this.sequence++ });
    const operator = this.buckets.get(originKey) ?? { window, attempts: 0, bytes: 0, order: this.sequence++ };
    if (clients.some((client) => client.attempts >= this.options.client.attempts || client.bytes + cap > this.options.client.bytes)) {
      for (const [i, client] of clients.entries()) {
        if (client.attempts >= this.options.client.attempts || client.bytes + cap > this.options.client.bytes) {
          client.denied = true; this.idle.remove(clientKeys[i]);
        }
      }
      return { ok: false, error: "client_budget_exhausted", status: 429, retryAfterSeconds };
    }
    if (operator.attempts >= this.options.origin.attempts || operator.bytes + cap > this.options.origin.bytes) {
      operator.denied = true; this.idle.remove(originKey);
      return { ok: false, error: "origin_budget_exhausted", status: 503, retryAfterSeconds };
    }
    const activeClientCounts = clientKeys.map((key) => this.activeClients.get(key) ?? 0);
    const activeClient = Math.max(0, ...activeClientCounts);
    const activeOrigin = this.activeOrigins.get(originKey) ?? 0;
    if (this.activeTotal >= this.options.maxConcurrentTotal || activeClient >= this.options.maxConcurrentPerClient) {
      return { ok: false, error: "client_budget_exhausted", status: 429, retryAfterSeconds };
    }
    if (activeOrigin >= this.options.maxConcurrentPerOrigin) {
      return { ok: false, error: "origin_budget_exhausted", status: 503, retryAfterSeconds };
    }
    const needed = this.buckets.size + newKeys - this.options.maxBuckets;
    const requestKeys = [...clientKeys, originKey];
    for (const key of requestKeys) this.idle.remove(key);
    if (needed > 0) {
      if (this.idle.size < needed) {
        for (const key of requestKeys) { const bucket = this.buckets.get(key); if (bucket) this.index(key, bucket); }
        return { ok: false, error: "budget_state_full", status: 503, retryAfterSeconds };
      }
      for (let i = 0; i < needed; i++) this.buckets.delete(this.idle.pop()!);
    }
    // Reserve both scopes synchronously before the first await. Failed attempts
    // keep their consumption charge; concurrency permits always release.
    for (const client of clients) { client.attempts++; client.bytes += cap; }
    operator.attempts++; operator.bytes += cap;
    for (const [index, key] of clientKeys.entries()) this.buckets.set(key, clients[index]);
    this.buckets.set(originKey, operator);
    this.activeTotal++;
    for (const key of clientKeys) this.activeClients.set(key, (this.activeClients.get(key) ?? 0) + 1);
    this.activeOrigins.set(originKey, activeOrigin + 1);
    try {
      const result = await fetcher(url, { ...limits, maxBytes: cap, maxRedirects: 0 });
      // Redirects must return to the budgeted adapter as separate admitted hops.
      if (result.ok) {
        const bytes = new TextEncoder().encode(result.text ?? "").byteLength;
        if (bytes > cap) return { ok: false, error: "too_large" };
        for (const client of clients) client.bytes -= cap - bytes;
        operator.bytes -= cap - bytes;
      }
      return result;
    } catch {
      return { ok: false, error: "network_error" };
    } finally {
      this.activeTotal--;
      for (const key of clientKeys) {
        const remaining = (this.activeClients.get(key) ?? 1) - 1;
        if (remaining <= 0) this.activeClients.delete(key);
        else this.activeClients.set(key, remaining);
      }
      const remainingOrigins = (this.activeOrigins.get(originKey) ?? 1) - 1;
      if (remainingOrigins <= 0) this.activeOrigins.delete(originKey);
      else this.activeOrigins.set(originKey, remainingOrigins);
      for (const [i, key] of clientKeys.entries()) this.index(key, clients[i]);
      this.index(originKey, operator);
    }
  }
}

export interface TrustedClientContext {
  runtime: "node" | "cloudflare";
  trustedCloudflareIngress?: boolean;
  secret?: string;
  previousSecret?: string;
  now?: number;
}
let latestHmacDay = Number.NEGATIVE_INFINITY;
export function __resetResolutionHmacDayForTests(): void { latestHmacDay = Number.NEGATIVE_INFINITY; }

/** Call only with server-controlled context; headers cannot select trust mode. */
export async function resolutionClientBuckets(request: Request, context: TrustedClientContext): Promise<string[]> {
  if (context.runtime !== "node" && context.runtime !== "cloudflare") return ["unknown"];
  if (!context.secret || context.secret.length < 32 || (context.previousSecret && context.previousSecret.length < 32)) return ["unknown"];
  if (context.runtime === "cloudflare" && !context.trustedCloudflareIngress) return ["unknown"];
  const ip = request.headers.get(context.runtime === "node" ? "x-portaless-client-ip" : "CF-Connecting-IP")?.trim();
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return ["unknown"];
  let canonical: string;
  try {
    const url = new URL(`https://${ip.includes(":") ? `[${ip}]` : ip}/`);
    if (!ip.includes(":") && !/^\d+(\.\d+){3}$/.test(url.hostname)) return ["unknown"];
    canonical = url.hostname;
  } catch { return ["unknown"]; }
  const encoder = new TextEncoder();
  latestHmacDay = Math.max(latestHmacDay, Math.floor((context.now ?? Date.now()) / 86_400_000));
  const day = latestHmacDay;
  const secrets = context.previousSecret ? [context.secret, context.previousSecret] : [context.secret];
  const buckets: string[] = [];
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${day}|${canonical}`));
    buckets.push(Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  return [...new Set(buckets)];
}

export async function resolutionClientBucket(request: Request, context: TrustedClientContext): Promise<string> {
  return (await resolutionClientBuckets(request, context))[0];
}
