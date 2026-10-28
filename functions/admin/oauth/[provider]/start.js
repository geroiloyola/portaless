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
import { publicOriginFromEnv } from "../../../_shared/public-origin.js";
import { oauthStateCookie } from "../../../_shared/request-security.js";
import { randomBytes } from "node:crypto";

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const provider = params.provider;
  const origin = publicOriginFromEnv(env);
  if (!origin) {
    return new Response("PORTALESS_PUBLIC_URL no configurada: no se puede iniciar OAuth sin un origen publico confiable.", { status: 503 });
  }
  const redirectUri = `${origin}/admin/oauth/${provider}/callback`;

  const config = loadOAuthProviderConfig(provider, env, redirectUri);
  if (!config) {
    return new Response(`El proveedor OAuth "${provider}" no está configurado en este despliegue.`, { status: 404 });
  }

  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkcePair();

  const authUrl = buildAuthorizationUrl(config, state, challenge);

  const headers = new Headers({ Location: authUrl });
  headers.append("Set-Cookie", oauthStateCookie(`${state}:${verifier}`, provider, request, env));

  return new Response(null, { status: 302, headers });
}
