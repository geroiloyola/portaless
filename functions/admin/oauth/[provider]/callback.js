// Cloudflare Pages Function -- GET /admin/oauth/:provider/callback
// Recibe el redirect del proveedor OAuth, valida state+PKCE, intercambia
// el codigo por el perfil del usuario, y crea la sesion de Portaless.
//
// Las cookies llevan Secure solo en HTTPS, igual que login.js y start.js.

import { AuthService } from "../../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore, createMfaChallengeStore } from "../../../../packages/auth/src/store-factory.ts";
import { loadOAuthProviderConfig, exchangeCodeForProfile } from "../../../../packages/auth/src/oauth.ts";
import { publicOriginFromEnv } from "../../../_shared/public-origin.js";
import { sessionCookie, clearOAuthStateCookie } from "../../../_shared/request-security.js";

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const provider = params.provider;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const origin = publicOriginFromEnv(env);
  if (!origin) {
    return new Response("PORTALESS_PUBLIC_URL no configurada: no se puede completar OAuth sin un origen publico confiable.", { status: 503 });
  }
  const redirectUri = `${origin}/admin/oauth/${provider}/callback`;

  if (!code || !returnedState) {
    return Response.redirect(new URL("/admin/login?error=1", origin), 302);
  }

  const stateCookie = getCookie(request, "portaless_oauth_state");
  if (!stateCookie) {
    return Response.redirect(new URL("/admin/login?error=1", origin), 302);
  }

  const [savedState, pkceVerifier] = stateCookie.split(":");
  if (savedState !== returnedState) {
    return Response.redirect(new URL("/admin/login?error=1", origin), 302);
  }

  const config = loadOAuthProviderConfig(provider, env, redirectUri);
  if (!config) {
    return new Response(`El proveedor OAuth "${provider}" no está configurado en este despliegue.`, { status: 404 });
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(config, code, pkceVerifier);
  } catch (err) {
    console.error(`[Portaless OAuth] Fallo el intercambio con ${provider}:`, err);
    return Response.redirect(new URL("/admin/login?error=1", origin), 302);
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const mfaChallengeStore = await createMfaChallengeStore(env);
  const authService = new AuthService(usersStore, sessionStore, undefined, undefined, mfaChallengeStore);

  const result = await authService.loginWithOAuth(profile);
  if (result.mfaRequired && result.mfaChallengeToken) {
    const headers = new Headers();
    const redirectUrl = new URL("/admin/login-mfa", origin);
    redirectUrl.searchParams.set("challenge", result.mfaChallengeToken);
    headers.set("Location", redirectUrl.toString());
    headers.append("Set-Cookie", clearOAuthStateCookie(provider, request, env));
    return new Response(null, { status: 302, headers });
  }
  if (!result.success || !result.session) {
    return Response.redirect(new URL("/admin/login?error=1", origin), 302);
  }

  const headers = new Headers({ Location: new URL("/admin", origin).toString() });
  headers.append("Set-Cookie", sessionCookie(result.session.token, request, env));
  headers.append("Set-Cookie", clearOAuthStateCookie(provider, request, env));

  return new Response(null, { status: 302, headers });
}
