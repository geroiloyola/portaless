/**
 * Hardened outbound fetch with per-hop redirect validation, streaming byte caps,
 * AbortSignal deadline, and optional DNS-pinning hook (L0-net).
 *
 * No static Node dependencies: `fetch`, `lookup`, and `fetchPinned` are injectable.
 * `resolvePinnedAddress` lazily loads `node:dns/promises` only when called without
 * a custom resolver hook.
 */
import {
  BLOCKED_EGRESS_CIDRS,
  isBlockedEgressIp,
  isBlockedHostname,
  isBlockedIp,
  isIpLiteral,
  isPrivateIp,
  normalizeHostname,
  parseIpv4Bytes,
  parseIpv6Bytes,
} from "./egress-ip";

export { BLOCKED_EGRESS_CIDRS, isPrivateIp };

export interface SafeFetchLimits {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_host"
  | "too_many_redirects"
  | "http_error"
  | "too_large"
  | "timeout"
  | "network_error";

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  text?: string;
  finalUrl?: string;
  error?: SafeFetchFailure;
}

export type PinnedFetch = (
  url: string,
  init: RequestInit,
  /** IP already validated by `lookup`; transport must connect to it without re-resolving. */
  address?: string,
) => Promise<Response>;

export interface SafeFetchDeps {
  fetch?: typeof fetch;
  /** Resolves a host to its IPs. On Node: (h) => dns.lookup(h, { all: true }).map(a => a.address). */
  lookup?: (host: string) => Promise<string[]>;
  /** Node transport with DNS pinning to prevent DNS rebinding between lookup and connect. */
  fetchPinned?: PinnedFetch;
}

export const SAFE_FETCH_DEFAULTS: Required<SafeFetchLimits> = {
  timeoutMs: 8000,
  maxBytes: 1_500_000,
  maxRedirects: 3,
};

async function resolveSafeAddress(
  url: URL,
  lookup?: (host: string) => Promise<string[]>,
): Promise<string | undefined> {
  if (url.protocol !== "https:") throw new Error("invalid_url");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("blocked_host");
  }
  if (isIpLiteral(host) && isPrivateIp(host)) throw new Error("blocked_host");
  if (!lookup) return undefined;

  let ips: string[];
  try {
    ips = await lookup(host);
  } catch {
    throw new Error("blocked_host");
  }
  if (ips.length === 0 || ips.some((ip) => isBlockedEgressIp(ip))) {
    throw new Error("blocked_host");
  }
  return ips[0];
}

export async function assertSafeUrl(
  url: URL,
  lookup?: (host: string) => Promise<string[]>,
): Promise<void> {
  await resolveSafeAddress(url, lookup);
}

async function readCapped(res: Response, maxBytes: number): Promise<string | "too_large"> {
  const reader = (res as unknown as { body?: ReadableStream<Uint8Array> | null }).body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? "too_large" : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const timedOut = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

export function createSafeFetcher(deps: SafeFetchDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const fetchHop: PinnedFetch = deps.fetchPinned ?? ((url, init) => doFetch(url, init));
  return async function safeFetch(
    url: string,
    limits: SafeFetchLimits = {},
  ): Promise<SafeFetchResult> {
    const { timeoutMs, maxBytes, maxRedirects } = { ...SAFE_FETCH_DEFAULTS, ...limits };
    const fail = (error: SafeFetchFailure, status?: number): SafeFetchResult => ({
      ok: false,
      error,
      status,
    });

    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return fail("invalid_url");
    }

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const signal = AbortSignal.timeout(timeoutMs);
      let address: string | undefined;
      try {
        address = await beforeDeadline(resolveSafeAddress(current, deps.lookup), signal);
      } catch (e) {
        if (timedOut(e)) return fail("timeout");
        return fail(e instanceof Error && e.message === "invalid_url" ? "invalid_url" : "blocked_host");
      }

      let res: Response;
      try {
        res = await beforeDeadline(
          fetchHop(
            current.toString(),
            {
              redirect: "manual",
              headers: { accept: "application/json" },
              signal,
            },
            address,
          ),
          signal,
        );
      } catch (e) {
        return fail(timedOut(e) ? "timeout" : "network_error");
      }

      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location) return fail("http_error", res.status);
        if (hop === maxRedirects) return fail("too_many_redirects");
        try {
          current = new URL(location, current);
        } catch {
          return fail("invalid_url");
        }
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return fail("http_error", res.status);
      }

      try {
        const body = await beforeDeadline(readCapped(res, maxBytes), signal);
        if (body === "too_large") return fail("too_large", res.status);
        return { ok: true, status: res.status, text: body, finalUrl: current.toString() };
      } catch (e) {
        return fail(timedOut(e) ? "timeout" : "network_error", res.status);
      }
    }

    return fail("too_many_redirects");
  };
}

export type SafeFetcher = ReturnType<typeof createSafeFetcher>;

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ResolveHook = (hostname: string) => Promise<ResolvedAddress[]>;

export type PinningErrorCode =
  | "deadline_exceeded"
  | "ssrf_blocked"
  | "service_unavailable";

export class PinningError extends Error {
  constructor(public readonly code: PinningErrorCode, message: string) {
    super(message);
    this.name = "PinningError";
  }
}

/**
 * Resolves a hostname once, rejects if ANY answer is in a blocked range, and
 * returns the exact address the socket must pin (anti-DNS-rebinding).
 */
export async function resolvePinnedAddress(
  hostname: string,
  resolver?: ResolveHook,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  if (signal?.aborted) throw new PinningError("deadline_exceeded", "dns resolution aborted");
  const host = normalizeHostname(hostname);
  if (isBlockedHostname(host)) throw new PinningError("ssrf_blocked", "blocked_endpoint_host");

  if (parseIpv4Bytes(host)) return { address: host, family: 4 };
  if (parseIpv6Bytes(host)) return { address: host, family: 6 };

  let answers: ResolvedAddress[];
  if (!resolver) {
    throw new PinningError("service_unavailable", "dns_resolver_required");
  }
  try {
    answers = await resolver(host);
  } catch {
    if (signal?.aborted) throw new PinningError("deadline_exceeded", "dns resolution aborted");
    throw new PinningError("service_unavailable", "dns_resolution_failed");
  }

  if (signal?.aborted) throw new PinningError("deadline_exceeded", "dns resolution aborted");
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new PinningError("service_unavailable", "dns_resolution_empty");
  }
  if (answers.some((answer) => isBlockedIp(answer.address))) {
    throw new PinningError("ssrf_blocked", "dns_answer_in_blocked_range");
  }
  return { address: answers[0].address, family: answers[0].family };
}
