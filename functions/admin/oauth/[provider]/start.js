// Cloudflare Pages Function -- GET /admin/oauth/:provider/start
// Redirige al usuario al proveedor OAuth configurado (ej. /admin/oauth/google/start).
// El state + PKCE verifier se guardan en una cookie de corta duracion --
// no se persiste en ningun store porque su vida util es de segundos (ida
// y vuelta del redirect), a diferencia de las sesiones reales.

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

  const headers = new Headers({ Location: authUrl });
  headers.append(
    "Set-Cookie",
    `portaless_oauth_state=${state}:${verifier}; Path=/admin/oauth/${provider}/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return new Response(null, { status: 302, headers });
}
