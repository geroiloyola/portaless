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

/** Check browser provenance for state-changing routes without trusting Host alone. */
export function isTrustedRequestOrigin(request, env = {}, { requireOrigin = false } = {}) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  const source = request.headers.get("origin") || request.headers.get("referer");
  if (!source) return !requireOrigin;

  const sourceOrigin = originFrom(source);
  if (!sourceOrigin) return false;

  const expected = new Set();
  const requestOrigin = originFrom(request.url);
  if (requestOrigin) expected.add(requestOrigin);
  if (typeof env.PORTALESS_PUBLIC_URL === "string" && env.PORTALESS_PUBLIC_URL.trim()) {
    const configuredOrigin = originFrom(env.PORTALESS_PUBLIC_URL.trim());
    if (configuredOrigin) expected.add(configuredOrigin);
  }
  return expected.has(sourceOrigin);
}
