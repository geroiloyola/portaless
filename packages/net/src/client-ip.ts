/**
 * Neutral client-IP and trusted-proxy parsing rules (L0-net, ROADMAP E-06).
 * Pure functions: never read HTTP headers (e.g. x-portaless-*) directly.
 * Host runtimes and adapters extract headers and pass raw strings here.
 */

/** Strips whitespace and IPv4-mapped `::ffff:` prefix, returning canonical IP or null. */
export function normalizeClientIp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^\[|\]$/g, "");
  if (!trimmed || !/^[0-9a-fA-F:.]+$/.test(trimmed)) return null;
  const unwrapped = trimmed.toLowerCase().startsWith("::ffff:") && trimmed.includes(".")
    ? trimmed.slice(7)
    : trimmed;
  try {
    const url = new URL(`https://${unwrapped.includes(":") ? `[${unwrapped}]` : unwrapped}/`);
    if (!unwrapped.includes(":") && !/^\d+(\.\d+){3}$/.test(url.hostname)) return null;
    return url.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/** Parses a comma-separated list of trusted proxy IPs into normalized canonical entries. */
export function parseTrustedProxies(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => normalizeClientIp(entry))
    .filter((ip): ip is string => ip !== null);
}

/**
 * Resolves the real client IP from a socket peer address and an optional
 * `X-Forwarded-For` chain given an explicit list of trusted proxy IPs.
 *
 * - Without trusted proxies (or when the peer is not in `trustedProxies`),
 *   always returns the normalized socket IP.
 * - Walks the chain right-to-left skipping trusted proxies; the first untrusted
 *   entry is the client IP.
 */
export function resolveClientIpFromProxyChain(
  socketIp: unknown,
  forwardedFor: unknown,
  trustedProxies: readonly string[] = [],
): string | null {
  const remote = normalizeClientIp(socketIp);
  if (!remote) return null;
  if (!trustedProxies.length || !trustedProxies.includes(remote)) return remote;
  const chain = String(forwardedFor || "")
    .split(",")
    .map((entry) => normalizeClientIp(entry))
    .filter((ip): ip is string => ip !== null);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!trustedProxies.includes(chain[i])) return chain[i];
  }
  return remote;
}

function protocolFromUrl(value: unknown): "http" | "https" | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return "https";
    if (url.protocol === "http:") return "http";
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Resolves effective request protocol (`http` | `https`):
 * 1. An HTTPS `publicUrl` always wins.
 * 2. Otherwise `forwardedProto` is trusted only when `socketIp` is in `trustedProxies`.
 * 3. Falls back to `publicUrl` protocol or `http`.
 */
export function resolveForwardedProtocol(
  socketIp: unknown,
  forwardedProto: unknown,
  trustedProxies: readonly string[] = [],
  publicUrl = "",
): "http" | "https" {
  const publicProtocol = protocolFromUrl(publicUrl);
  if (publicProtocol === "https") return "https";
  const remote = normalizeClientIp(socketIp);
  if (remote && trustedProxies.length && trustedProxies.includes(remote)) {
    const proto = String(forwardedProto || "").split(",")[0].trim().toLowerCase();
    if (proto === "https" || proto === "http") return proto;
  }
  return publicProtocol || "http";
}
