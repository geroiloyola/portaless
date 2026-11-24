import { createRateLimitStore } from "@portaless/auth/store-factory";
import { allowActionRequest } from "@portaless/auth/rate-limit";
import { clientIpFromHeaders } from "@portaless/auth/password-reset-rate-limit";
import { createSafeFetcher } from "@verared/apw/federation";

export const PUBLIC_TRUST_WINDOW_MS = 60 * 60 * 1000;

/**
 * Per-IP admission for unauthenticated work. It is charged before parsing or
 * network fan-out, so a public endpoint cannot be used as an amplifier.
 */
export async function allowPublicEgress(env, request, {
  action,
  ipLimit = 10,
  actorLimit = 10,
  actor,
  windowMs = PUBLIC_TRUST_WINDOW_MS,
} = {}) {
  const store = await createRateLimitStore(env);
  const ip = clientIpFromHeaders(request.headers, env);
  return allowActionRequest(store, {
    action,
    ip,
    actor: actor ?? ip,
    ipLimit,
    actorLimit,
    windowMs,
  });
}

/**
 * A `fetch`-shaped adapter over the hardened fetcher. The caller gets a
 * Response so existing APW resolvers stay unchanged, while every outbound
 * request is HTTPS-only, SSRF-checked, byte-capped, time-bounded and limited
 * to a small number of hops/requests per public request.
 */
export function createBoundedPublicFetch(env, {
  timeoutMs = 2500,
  maxBytes = 256 * 1024,
  maxRequests = 8,
  deadlineMs = 6000,
} = {}) {
  const safeFetch = env?.__PORTALESS_DIRECTORY_FETCHER ?? createSafeFetcher();
  const deadline = Date.now() + deadlineMs;
  let requests = 0;

  return async function boundedFetch(input) {
    if (++requests > maxRequests || Date.now() >= deadline) {
      return new Response("", { status: 429, headers: { "retry-after": "1" } });
    }
    const url = typeof input === "string" ? input : input?.url;
    if (!url) return new Response("", { status: 400 });
    const remaining = Math.max(1, deadline - Date.now());
    const result = await safeFetch(url, {
      timeoutMs: Math.min(timeoutMs, remaining),
      maxBytes,
      maxRedirects: 0,
    });
    if (result.ok) {
      return new Response(result.text ?? "", {
        status: result.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: result.status ?? 502 });
  };
}
