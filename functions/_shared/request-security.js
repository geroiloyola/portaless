// Politica unica de cookie de sesion y deteccion de TLS.
//
// El runtime Node calcula el protocolo real (X-Forwarded-Proto solo si la
// conexion viene de PORTALESS_TRUSTED_PROXIES, o la URL publica configurada) y
// expone el resultado en x-portaless-request-proto. Ese header interno no se
// acepta del cliente: node-runtime lo descarta y lo reescribe. Cloudflare ya
// entrega request.url con https.
export const REQUEST_PROTO_HEADER = "x-portaless-request-proto";

export function isSecureRequest(request, env = {}) {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    return false;
  }
  if (env?.__PORTALESS_RUNTIME === "node") {
    return request.headers.get(REQUEST_PROTO_HEADER) === "https";
  }
  return false;
}

const INVALID_COOKIE_VALUE_RE = /[\r\n;]/;

/**
 * B-01: Parser exacto de cookies por nombre sin regex ni coincidencias parciales
 * (p. ej. `evil_portaless_session` nunca coincide con `portaless_session`).
 */
export function getCookie(request, name, { decode = false } = {}) {
  if (typeof name !== "string" || !name) return null;
  const cookieHeader = request?.headers?.get?.("Cookie") || "";
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const raw = part.slice(idx + 1).trim();
      if (!decode) return raw;
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Cookie de sesion unica: HttpOnly, SameSite=Strict y Secure detras de TLS. */
export function sessionCookie(token, request, env, { maxAge = 24 * 60 * 60 } = {}) {
  const safeToken = String(token ?? "");
  if (INVALID_COOKIE_VALUE_RE.test(safeToken)) {
    throw new Error("Invalid session cookie token.");
  }
  const flags = [
    `portaless_session=${safeToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request, env)) flags.push("Secure");
  return flags.join("; ");
}

/** B-05: Limpieza consistente de la cookie de sesion con los mismos atributos. */
export function clearSessionCookie(request, env) {
  return sessionCookie("", request, env, { maxAge: 0 });
}

import { normalizeOAuthProvider, oauthStateCookieName } from "@portaless/auth/oauth";

/** Cookie efimera de state OAuth ligada al proveedor (M-07). Lax es necesario para el redirect del proveedor; no es la cookie de sesion. */
export function oauthStateCookie(value, provider, request, env, { maxAge = 600 } = {}) {
  const normalized = normalizeOAuthProvider(provider);
  if (!normalized) {
    throw new Error(`Invalid OAuth provider identifier: "${String(provider)}"`);
  }
  const cookieName = oauthStateCookieName(normalized);
  const encodedValue = value ? encodeURIComponent(value) : "";
  const flags = [
    `${cookieName}=${encodedValue}`,
    `Path=/admin/oauth/${normalized}/callback`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request, env)) flags.push("Secure");
  return flags.join("; ");
}

export function clearOAuthStateCookie(provider, request, env) {
  return oauthStateCookie("", provider, request, env, { maxAge: 0 });
}
