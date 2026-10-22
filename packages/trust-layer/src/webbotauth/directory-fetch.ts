import { createSafeFetcher, isPrivateIp, type SafeFetcher } from "../../../apw-resolver/src/federation/safe-fetch";
import type { ResolutionBudget } from "../net/resolution-budget";

export const DIRECTORY_FETCH_IN_FLIGHT_MAX = 8;
export const DIRECTORY_FETCH_RESERVED = 2;
export const DIRECTORY_FETCH_COLD_MAX = DIRECTORY_FETCH_IN_FLIGHT_MAX - DIRECTORY_FETCH_RESERVED;
export const DIRECTORY_NEGATIVE_CACHE_MAX = 256;
const TTL = 600_000;
const FAILURE_TTL = 60_000;
const PATH = "/.well-known/http-message-signatures-directory";

export interface DirectoryResponse {
  keys: Array<{ kid: string; kty: string; crv?: string; x?: string; alg?: string; pub?: string }>;
}
export type DirectoryResult =
  | { ok: true; directory: DirectoryResponse }
  | { ok: false; reason: "directory_busy" | "directory_unavailable" | "directory_failure_cached" | "client_budget_exhausted" | "origin_budget_exhausted" | "budget_state_full"; retryAfterSeconds: number; status?: 429 | 503 };

export interface DirectoryBudgetContext {
  budget: ResolutionBudget;
  clientBucket: string | readonly string[];
}

export function normalizeDirectoryOrigin(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.toLowerCase().replace(/[.]$/, "");
  return url.origin;
}

/** Owner configuration only. Invalid/excess entries never create a reservation. */
export function parseReservedDirectoryOrigins(raw = ""): { origins: string[]; invalidCount: number } {
  const origins = new Set<string>();
  let invalidCount = 0;
  const entries = raw.split(",").map((value) => value.trim()).filter(Boolean);
  for (const [index, value] of entries.entries()) {
    try {
      if (index >= 256) throw new Error("excess_entries");
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) throw new Error("invalid_origin");
      const origin = normalizeDirectoryOrigin(value);
      const host = new URL(origin).hostname;
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
        || ((host.includes(":") || /^\d+(\.\d+){3}$/.test(host)) && isPrivateIp(host))) throw new Error("blocked_host");
      origins.add(origin);
    } catch { invalidCount++; }
  }
  return { origins: [...origins], invalidCount };
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > DIRECTORY_NEGATIVE_CACHE_MAX) map.delete(map.keys().next().value!);
}

/** Per-process admission, not a per-window egress budget or authentication. */
export class DirectoryResolver {
  private positive = new Map<string, { directory: DirectoryResponse; until: number }>();
  private negative = new Map<string, number>();
  private inflight = new Map<string, Promise<DirectoryResult>>();
  private coldInFlight = 0;

  constructor(private now: () => number = Date.now) {}

  state() {
    return { positive: this.positive.size, negative: this.negative.size, inFlight: this.inflight.size };
  }

  resolve(origin: string, fetcher: SafeFetcher = createSafeFetcher(), reservedOrigins: readonly string[] = [], budgetContext?: DirectoryBudgetContext): Promise<DirectoryResult> {
    const key = normalizeDirectoryOrigin(origin);
    const cached = this.positive.get(key);
    if (cached && cached.until > this.now()) return Promise.resolve({ ok: true, directory: cached.directory });
    this.positive.delete(key);
    const failedUntil = this.negative.get(key);
    if (failedUntil !== undefined && failedUntil > this.now()) {
      // LRU hit refreshes recency, never extends the failure TTL.
      boundedSet(this.negative, key, failedUntil);
      return Promise.resolve({ ok: false, reason: "directory_failure_cached", retryAfterSeconds: Math.max(1, Math.ceil((failedUntil - this.now()) / 1000)) });
    }
    this.negative.delete(key);
    const pending = this.inflight.get(key);
    if (pending) return pending; // per-origin maximum: one fetch, shared result

    // A valid signature is cheap for attacker-owned domains. It proves key
    // control, never eligibility for scarce reserved admission capacity.
    const reserved = parseReservedDirectoryOrigins(reservedOrigins.join(",")).origins.includes(key);
    if (this.inflight.size >= DIRECTORY_FETCH_IN_FLIGHT_MAX || (!reserved && this.coldInFlight >= DIRECTORY_FETCH_COLD_MAX)) {
      return Promise.resolve({ ok: false, reason: "directory_busy", retryAfterSeconds: 1 });
    }
    if (!reserved) this.coldInFlight++;
    // Start asynchronously so the single-flight entry exists before any fetch.
    const task = Promise.resolve().then(async (): Promise<DirectoryResult> => {
      try {
        const limits = { timeoutMs: 5000, maxBytes: 512 * 1024, maxRedirects: 0 };
        const res = budgetContext
          ? await budgetContext.budget.fetch({ clientBucket: budgetContext.clientBucket, directoryOrigin: key, stage: "directory" }, new URL(PATH, key).href, fetcher, limits)
          : await fetcher(new URL(PATH, key).href, { ...limits, maxRedirects: 2 });
        if (!res.ok && "retryAfterSeconds" in res) {
          return { ok: false, reason: res.error, retryAfterSeconds: res.retryAfterSeconds, status: res.status };
        }
        if (res.ok && res.text) {
          const directory = JSON.parse(res.text) as DirectoryResponse;
          if (Array.isArray(directory?.keys) && directory.keys.every((entry) => entry && typeof entry.kid === "string")) {
            boundedSet(this.positive, key, { directory, until: this.now() + TTL });
            this.negative.delete(key);
            return { ok: true, directory };
          }
        }
      } catch { /* Unavailable/malformed directory is not proof of a bad signature. */ }
      boundedSet(this.negative, key, this.now() + FAILURE_TTL);
      return { ok: false, reason: "directory_unavailable", retryAfterSeconds: FAILURE_TTL / 1000 };
    }).finally(() => {
      this.inflight.delete(key);
      if (!reserved) this.coldInFlight--;
    });
    this.inflight.set(key, task);
    return task;
  }
}
