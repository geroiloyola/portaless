// Cloudflare Pages Function -- GET /admin/oauth/:provider/callback
// Recibe el redirect del proveedor OAuth, valida state+PKCE, intercambia
// el codigo por el perfil del usuario, y crea la sesion de Portaless.

import { AuthService } from "../../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../../packages/auth/src/store-factory.ts";
import { loadOAuthProviderConfig, exchangeCodeForProfile } from "../../../../packages/auth/src/oauth.ts";

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
  const redirectUri = `${url.origin}/admin/oauth/${provider}/callback`;

  if (!code || !returnedState) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  const stateCookie = getCookie(request, "portaless_oauth_state");
  if (!stateCookie) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  const [savedState, pkceVerifier] = stateCookie.split(":");
  if (savedState !== returnedState) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
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
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const authService = new AuthService(usersStore, sessionStore);

  const result = await authService.loginWithOAuth(profile);
  if (!result.success || !result.session) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  const headers = new Headers({ Location: new URL("/admin", url.origin).toString() });
  headers.append(
    "Set-Cookie",
    `portaless_session=${result.session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
  );
  headers.append("Set-Cookie", `portaless_oauth_state=; Path=/admin/oauth/${provider}/callback; Max-Age=0`);

  return new Response(null, { status: 302, headers });
}
