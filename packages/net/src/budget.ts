/**
 * Neutral egress & operation resource budgets (L0-net).
 * No Portaless headers, no SQLite/D1 dependencies.
 */
import type { SafeFetchLimits, SafeFetchResult, SafeFetcher } from "./safe-fetch";

// ---------------------------------------------------------------------------
// 1. Per-operation resource budget (used by Local Trust Protocol acquisition)
// ---------------------------------------------------------------------------

export interface OperationLimits {
  readonly httpAttempts: number;
  readonly bodyBytes: number;
  readonly signatureAttempts: number;
  readonly deadlineMs: number;
}

export type OperationBudgetErrorCode =
  | "deadline_exceeded"
  | "budget_exhausted"
  | "response_limit_exceeded";

export class OperationBudgetError extends Error {
  constructor(
    public readonly code: OperationBudgetErrorCode,
    message: string,
    public readonly stage?: string,
  ) {
    super(message);
    this.name = "OperationBudgetError";
  }
}

export interface HttpResponseBudget {
  settle(actualBytes: number): void;
}

export class OperationBudget<TLimits extends OperationLimits = OperationLimits> {
  httpAttemptsUsed = 0;
  bodyBytesUsed = 0;
  signatureAttemptsUsed = 0;

  constructor(
    public readonly limits: TLimits,
    private readonly now: () => number,
  ) {}

  elapsedMs(): number {
    return this.now();
  }

  checkDeadline(stage: string): void {
    if (!Number.isFinite(this.elapsedMs()) || this.elapsedMs() < 0) {
      throw new OperationBudgetError("deadline_exceeded", "invalid monotonic clock", stage);
    }
    if (this.elapsedMs() >= this.limits.deadlineMs) {
      throw new OperationBudgetError("deadline_exceeded", "shared operation deadline exceeded", stage);
    }
  }

  reserveHttp(byteCap: number, stage: string): HttpResponseBudget {
    this.checkDeadline(stage);
    if (this.httpAttemptsUsed >= this.limits.httpAttempts) {
      throw new OperationBudgetError("budget_exhausted", "http attempt limit reached", stage);
    }
    if (!Number.isSafeInteger(byteCap) || byteCap <= 0) {
      throw new OperationBudgetError("response_limit_exceeded", "invalid body allowance", stage);
    }
    if (this.bodyBytesUsed + byteCap > this.limits.bodyBytes) {
      throw new OperationBudgetError("response_limit_exceeded", "composed body allowance reached", stage);
    }
    this.httpAttemptsUsed += 1;
    this.bodyBytesUsed += byteCap;
    let settled = false;
    return {
      settle: (actualBytes: number) => {
        if (settled) throw new Error("http reservation settled twice");
        settled = true;
        if (!Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > byteCap) {
          throw new OperationBudgetError("response_limit_exceeded", "response exceeds its pre-reserved cap", stage);
        }
        this.bodyBytesUsed -= byteCap - actualBytes;
      },
    };
  }

  reserveSignature(stage: string): void {
    this.checkDeadline(stage);
    if (this.signatureAttemptsUsed >= this.limits.signatureAttempts) {
      throw new OperationBudgetError("budget_exhausted", "signature attempt limit reached", stage);
    }
    this.signatureAttemptsUsed += 1;
  }
}

// ---------------------------------------------------------------------------
// 2. Indexed min-heap for bounded idle bucket eviction
// ---------------------------------------------------------------------------

interface IdleEntry {
  key: string;
  attempts: number;
  bytes: number;
  order: number;
}

/** Indexed min-heap: one entry per eligible idle bucket, never lazy tombstones. */
export class IdleBucketIndex {
  private entries: IdleEntry[] = [];
  private positions = new Map<string, number>();

  get size() {
    return this.entries.length;
  }

  private less(a: IdleEntry, b: IdleEntry) {
    return (
      a.attempts < b.attempts ||
      (a.attempts === b.attempts &&
        (a.bytes < b.bytes || (a.bytes === b.bytes && a.order < b.order)))
    );
  }

  private swap(a: number, b: number) {
    [this.entries[a], this.entries[b]] = [this.entries[b], this.entries[a]];
    this.positions.set(this.entries[a].key, a);
    this.positions.set(this.entries[b].key, b);
  }

  private up(index: number) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(this.entries[index], this.entries[parent])) break;
      this.swap(index, parent);
      index = parent;
    }
    return index;
  }

  private down(index: number) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.size && this.less(this.entries[left], this.entries[best])) best = left;
      if (right < this.size && this.less(this.entries[right], this.entries[best])) best = right;
      if (best === index) return;
      this.swap(index, best);
      index = best;
    }
  }

  remove(key: string) {
    const index = this.positions.get(key);
    if (index === undefined) return;
    this.positions.delete(key);
    const last = this.entries.pop()!;
    if (index === this.size) return;
    this.entries[index] = last;
    this.positions.set(last.key, index);
    this.down(this.up(index));
  }

  set(entry: IdleEntry) {
    this.remove(entry.key);
    this.positions.set(entry.key, this.size);
    this.entries.push(entry);
    this.up(this.size - 1);
  }

  pop(): string | undefined {
    const key = this.entries[0]?.key;
    if (key !== undefined) this.remove(key);
    return key;
  }
}

// ---------------------------------------------------------------------------
// 3. Per-window unauthenticated resolution admission & egress budget
// ---------------------------------------------------------------------------

export const RESOLUTION_STAGES = ["directory", "txt_doh", "did", "history", "evidence"] as const;
export type ResolutionStage = (typeof RESOLUTION_STAGES)[number];

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

interface Quota {
  attempts: number;
  bytes: number;
}

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
  windowMs: 60_000,
  client: { attempts: 20, bytes: 8 * 1024 * 1024 },
  origin: { attempts: 8, bytes: 4 * 1024 * 1024 },
  maxBuckets: 4096,
  maxConcurrentTotal: 8,
  maxConcurrentPerClient: 4,
  maxConcurrentPerOrigin: 4,
};

export type BudgetRejection = {
  ok: false;
  error: "client_budget_exhausted" | "origin_budget_exhausted" | "budget_state_full";
  status: 429 | 503;
  retryAfterSeconds: number;
};

interface Bucket {
  window: number;
  attempts: number;
  bytes: number;
  order: number;
  denied?: boolean;
}

export class ResolutionBudget {
  private buckets = new Map<string, Bucket>();
  private idle = new IdleBucketIndex();
  private window = -1;
  private sequence = 0;
  private activeClients = new Map<string, number>();
  private activeOrigins = new Map<string, number>();
  private activeTotal = 0;
  private options: ResolutionBudgetOptions;

  constructor(
    options: ResolutionBudgetOptions = RESOLUTION_BUDGET_PROPOSAL,
    private now: () => number = () => performance.now(),
  ) {
    this.options = { ...options, client: { ...options.client }, origin: { ...options.origin } };
    const numbers = [
      options.windowMs,
      options.maxBuckets,
      options.client.attempts,
      options.client.bytes,
      options.origin.attempts,
      options.origin.bytes,
      options.maxConcurrentTotal,
      options.maxConcurrentPerClient,
      options.maxConcurrentPerOrigin,
    ];
    if (numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) || options.maxBuckets < 2) {
      throw new Error("invalid_resolution_budget");
    }
  }

  stateForTests() {
    return {
      buckets: [...this.buckets].map(([key, value]) => ({ key, ...value })),
      activeTotal: this.activeTotal,
      activeClients: [...this.activeClients],
      activeOrigins: [...this.activeOrigins],
      idleEntries: this.idle.size,
    };
  }

  private index(key: string, bucket: Bucket) {
    if (this.buckets.get(key) !== bucket) return;
    this.idle.remove(key);
    const quota = key.startsWith("client:") ? this.options.client : this.options.origin;
    if (
      bucket.denied ||
      bucket.attempts >= quota.attempts ||
      bucket.bytes >= quota.bytes ||
      this.activeClients.has(key) ||
      this.activeOrigins.has(key)
    ) {
      return;
    }
    this.idle.set({ key, attempts: bucket.attempts, bytes: bucket.bytes, order: bucket.order });
  }

  async fetch(
    context: ResolutionContext,
    url: string,
    fetcher: SafeFetcher,
    limits: SafeFetchLimits = {},
  ): Promise<SafeFetchResult | BudgetRejection> {
    const clientBuckets = [
      ...new Set(Array.isArray(context.clientBucket) ? context.clientBucket : [context.clientBucket]),
    ];
    if (
      !RESOLUTION_STAGES.includes(context.stage) ||
      !clientBuckets.length ||
      clientBuckets.length > 2 ||
      clientBuckets.some((bucket) => !/^(?:unknown|[a-f0-9]{64})$/.test(bucket))
    ) {
      throw new Error("invalid_resolution_context");
    }
    const origin = normalizeResolutionOrigin(context.directoryOrigin);
    if (!origin.startsWith("https://")) throw new Error("invalid_resolution_origin");
    const cap = limits.maxBytes ?? 512 * 1024;
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error("invalid_resolution_byte_cap");

    const timestamp = this.now();
    const window = Math.floor(timestamp / this.options.windowMs);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(((window + 1) * this.options.windowMs - timestamp) / 1000),
    );
    const clientKeys = clientBuckets.map((bucket) => `client:${bucket}`);
    const originKey = `origin:${origin}`;

    if (window !== this.window) {
      this.buckets = new Map();
      this.idle = new IdleBucketIndex();
      this.window = window;
    }

    const newKeys =
      clientKeys.filter((key) => !this.buckets.has(key)).length + Number(!this.buckets.has(originKey));
    const clients = clientKeys.map(
      (key) => this.buckets.get(key) ?? { window, attempts: 0, bytes: 0, order: this.sequence++ },
    );
    const operator =
      this.buckets.get(originKey) ?? { window, attempts: 0, bytes: 0, order: this.sequence++ };

    if (
      clients.some(
        (client) =>
          client.attempts >= this.options.client.attempts ||
          client.bytes + cap > this.options.client.bytes,
      )
    ) {
      for (const [i, client] of clients.entries()) {
        if (
          client.attempts >= this.options.client.attempts ||
          client.bytes + cap > this.options.client.bytes
        ) {
          client.denied = true;
          this.idle.remove(clientKeys[i]);
        }
      }
      return { ok: false, error: "client_budget_exhausted", status: 429, retryAfterSeconds };
    }

    if (
      operator.attempts >= this.options.origin.attempts ||
      operator.bytes + cap > this.options.origin.bytes
    ) {
      operator.denied = true;
      this.idle.remove(originKey);
      return { ok: false, error: "origin_budget_exhausted", status: 503, retryAfterSeconds };
    }

    const activeClientCounts = clientKeys.map((key) => this.activeClients.get(key) ?? 0);
    const activeClient = Math.max(0, ...activeClientCounts);
    const activeOrigin = this.activeOrigins.get(originKey) ?? 0;
    if (
      this.activeTotal >= this.options.maxConcurrentTotal ||
      activeClient >= this.options.maxConcurrentPerClient
    ) {
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
        for (const key of requestKeys) {
          const bucket = this.buckets.get(key);
          if (bucket) this.index(key, bucket);
        }
        return { ok: false, error: "budget_state_full", status: 503, retryAfterSeconds };
      }
      for (let i = 0; i < needed; i++) this.buckets.delete(this.idle.pop()!);
    }

    for (const client of clients) {
      client.attempts++;
      client.bytes += cap;
    }
    operator.attempts++;
    operator.bytes += cap;
    for (const [index, key] of clientKeys.entries()) this.buckets.set(key, clients[index]);
    this.buckets.set(originKey, operator);
    this.activeTotal++;
    for (const key of clientKeys) {
      this.activeClients.set(key, (this.activeClients.get(key) ?? 0) + 1);
    }
    this.activeOrigins.set(originKey, activeOrigin + 1);

    try {
      const result = await fetcher(url, { ...limits, maxBytes: cap, maxRedirects: 0 });
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

// ---------------------------------------------------------------------------
// 4. Neutral HMAC client-IP bucketing (receives explicit IP, reads no headers)
// ---------------------------------------------------------------------------

export interface ClientIpHashOptions {
  secret?: string;
  previousSecret?: string;
  now?: number;
}

let latestHmacDay = Number.NEGATIVE_INFINITY;

export function __resetResolutionHmacDayForTests(): void {
  latestHmacDay = Number.NEGATIVE_INFINITY;
}

/**
 * Computes rotating daily HMAC-SHA256 buckets for an already-verified client IP.
 * Never reads HTTP headers directly; adapters extract the trusted IP first.
 */
export async function hashClientIpBuckets(
  rawClientIp: string | null | undefined,
  options: ClientIpHashOptions,
): Promise<string[]> {
  if (
    !options.secret ||
    options.secret.length < 32 ||
    (options.previousSecret && options.previousSecret.length < 32)
  ) {
    return ["unknown"];
  }
  const ip = typeof rawClientIp === "string" ? rawClientIp.trim() : "";
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return ["unknown"];
  let canonical: string;
  try {
    const url = new URL(`https://${ip.includes(":") ? `[${ip}]` : ip}/`);
    if (!ip.includes(":") && !/^\d+(\.\d+){3}$/.test(url.hostname)) return ["unknown"];
    canonical = url.hostname;
  } catch {
    return ["unknown"];
  }

  const encoder = new TextEncoder();
  latestHmacDay = Math.max(latestHmacDay, Math.floor((options.now ?? Date.now()) / 86_400_000));
  const day = latestHmacDay;
  const secrets = options.previousSecret
    ? [options.secret, options.previousSecret]
    : [options.secret];
  const buckets: string[] = [];
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${day}|${canonical}`));
    buckets.push(
      Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
  }
  return [...new Set(buckets)];
}
