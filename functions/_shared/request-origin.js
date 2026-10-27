function originFrom(value) {
  if (typeof value !== "string" || !value || value === "null") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Check browser provenance for state-changing routes without trusting Host.
 *
 * PORTALESS_PUBLIC_URL is the only trusted origin. request.url is built from
 * the Host header in self-host, so using it here would degenerate into
 * "Origin equals Host" and let a DNS-rebinding/non-browser client pass.
 */
export function isTrustedRequestOrigin(request, env = {}, { requireOrigin = false } = {}) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  const configuredOrigin = originFrom(env?.PORTALESS_PUBLIC_URL);
  if (!configuredOrigin) return false;

  const source = request.headers.get("origin") || request.headers.get("referer");
  if (!source) return !requireOrigin;
  return originFrom(source) === configuredOrigin;
}
