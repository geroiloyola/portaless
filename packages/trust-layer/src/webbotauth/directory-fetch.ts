import { createSafeFetcher, type SafeFetcher } from "../../../apw-resolver/src/federation/safe-fetch";

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
  | { ok: false; reason: "directory_busy" | "directory_unavailable" | "directory_failure_cached"; retryAfterSeconds: number };

export function normalizeDirectoryOrigin(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.toLowerCase().replace(/[.]$/, "");
  return url.origin;
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
  private verified = new Map<string, true>();
  private inflight = new Map<string, Promise<DirectoryResult>>();
  private coldInFlight = 0;

  constructor(private now: () => number = Date.now) {}

  markVerified(origin: string): void {
    boundedSet(this.verified, normalizeDirectoryOrigin(origin), true);
  }

  state() {
    return { positive: this.positive.size, negative: this.negative.size, inFlight: this.inflight.size };
  }

  resolve(origin: string, fetcher: SafeFetcher = createSafeFetcher(), reservedOrigins: readonly string[] = []): Promise<DirectoryResult> {
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

    const reserved = this.verified.has(key) || reservedOrigins.slice(0, 256).some((value) => {
      try { return normalizeDirectoryOrigin(value) === key; } catch { return false; }
    });
    if (this.inflight.size >= DIRECTORY_FETCH_IN_FLIGHT_MAX || (!reserved && this.coldInFlight >= DIRECTORY_FETCH_COLD_MAX)) {
      return Promise.resolve({ ok: false, reason: "directory_busy", retryAfterSeconds: 1 });
    }
    if (!reserved) this.coldInFlight++;
    // Start asynchronously so the single-flight entry exists before any fetch.
    const task = Promise.resolve().then(async (): Promise<DirectoryResult> => {
      try {
        const res = await fetcher(new URL(PATH, key).href, { timeoutMs: 5000, maxBytes: 512 * 1024, maxRedirects: 2 });
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
