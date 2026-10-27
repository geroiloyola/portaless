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

/** Cookie de sesion unica: HttpOnly, SameSite=Strict y Secure detras de TLS. */
export function sessionCookie(token, request, env, { maxAge = 24 * 60 * 60 } = {}) {
  const flags = [
    `portaless_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request, env)) flags.push("Secure");
  return flags.join("; ");
}

/** Cookie efimera de state OAuth. Lax es necesario para el redirect del proveedor; no es la cookie de sesion. */
export function oauthStateCookie(value, provider, request, env, { maxAge = 600 } = {}) {
  const flags = [
    `portaless_oauth_state=${value}`,
    `Path=/admin/oauth/${provider}/callback`,
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
