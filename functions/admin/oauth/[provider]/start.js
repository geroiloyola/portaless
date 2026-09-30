// Cloudflare Pages Function -- GET /admin/oauth/:provider/start
// Redirige al usuario al proveedor OAuth configurado (ej. /admin/oauth/google/start).
// El state + PKCE verifier se guardan en una cookie de corta duracion --
// no se persiste en ningun store porque su vida util es de segundos (ida
// y vuelta del redirect), a diferencia de las sesiones reales.
//
// La cookie lleva Secure solo en HTTPS, igual que login.js: en self-hosted por
// HTTP en una IP de red local el navegador descartaria una cookie Secure y el
// callback nunca encontraria el state.

import { loadOAuthProviderConfig, generatePkcePair, buildAuthorizationUrl } from "../../../../packages/auth/src/oauth.ts";
import { randomBytes } from "node:crypto";

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const provider = params.provider;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/admin/oauth/${provider}/callback`;

  const config = loadOAuthProviderConfig(provider, env, redirectUri);
  if (!config) {
    return new Response(`El proveedor OAuth "${provider}" no está configurado en este despliegue.`, { status: 404 });
  }

  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkcePair();

  const authUrl = buildAuthorizationUrl(config, state, challenge);

  const cookieFlags = [
    `portaless_oauth_state=${state}:${verifier}`,
    `Path=/admin/oauth/${provider}/callback`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
  ];
  if (url.protocol === "https:") cookieFlags.push("Secure");

  const headers = new Headers({ Location: authUrl });
  headers.append("Set-Cookie", cookieFlags.join("; "));

  return new Response(null, { status: 302, headers });
}
