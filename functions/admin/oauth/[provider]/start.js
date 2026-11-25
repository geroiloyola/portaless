// Cloudflare Pages Function -- GET /admin/oauth/:provider/start
// Redirige al usuario al proveedor OAuth configurado (ej. /admin/oauth/google/start).
// El state + PKCE verifier se guardan ligados al proveedor en una cookie de
// corta duracion (`portaless_oauth_state_<provider>`, M-07).

import {
  loadOAuthProviderConfig,
  generatePkcePair,
  buildAuthorizationUrl,
  normalizeOAuthProvider,
  encodeOAuthStateCookieValue,
} from "@portaless/auth/oauth";
import { publicOriginFromEnv } from "../../../_shared/public-origin.js";
import { oauthStateCookie } from "../../../_shared/request-security.js";
import { randomBytes } from "node:crypto";

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const provider = normalizeOAuthProvider(params.provider);
  if (!provider) {
    return new Response("Proveedor OAuth inválido.", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const origin = publicOriginFromEnv(env);
  if (!origin) {
    return new Response("PORTALESS_PUBLIC_URL no configurada: no se puede iniciar OAuth sin un origen publico confiable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const redirectUri = `${origin}/admin/oauth/${provider}/callback`;

  const config = loadOAuthProviderConfig(provider, env, redirectUri);
  if (!config) {
    return new Response(`El proveedor OAuth "${provider}" no está configurado en este despliegue.`, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkcePair();

  const authUrl = buildAuthorizationUrl(config, state, challenge);

  const headers = new Headers({
    Location: authUrl,
    "Cache-Control": "no-store",
  });
  const cookieValue = encodeOAuthStateCookieValue(provider, state, verifier);
  headers.append("Set-Cookie", oauthStateCookie(cookieValue, provider, request, env));

  return new Response(null, { status: 302, headers });
}
