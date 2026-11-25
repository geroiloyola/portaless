// Cloudflare Pages Function -- GET /admin/oauth/:provider/callback
// Recibe el redirect del proveedor OAuth, valida proveedor+state+PKCE contra
// la cookie ligada al proveedor (`portaless_oauth_state_<provider>`, M-07),
// intercambia el codigo por el perfil del usuario, y crea la sesion de Portaless.

import { timingSafeEqual } from "node:crypto";
import { AuthService } from "@portaless/auth/service";
import { createUsersStore, createSessionStore, createMfaChallengeStore } from "@portaless/auth/store-factory";
import {
  loadOAuthProviderConfig,
  exchangeCodeForProfile,
  normalizeOAuthProvider,
  oauthStateCookieName,
  decodeOAuthStateCookieValue,
} from "@portaless/auth/oauth";
import { publicOriginFromEnv } from "../../../_shared/public-origin.js";
import { sessionCookie, clearOAuthStateCookie } from "../../../_shared/request-security.js";

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function safeStateEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function redirectLoginError(origin, provider, request, env) {
  const headers = new Headers({ Location: new URL("/admin/login?error=1", origin).toString() });
  headers.append("Set-Cookie", clearOAuthStateCookie(provider, request, env));
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const provider = normalizeOAuthProvider(params.provider);
  if (!provider) {
    return new Response("Proveedor OAuth inválido.", { status: 400 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const origin = publicOriginFromEnv(env);
  if (!origin) {
    return new Response("PORTALESS_PUBLIC_URL no configurada: no se puede completar OAuth sin un origen publico confiable.", { status: 503 });
  }
  const redirectUri = `${origin}/admin/oauth/${provider}/callback`;

  if (!code || !returnedState) {
    return redirectLoginError(origin, provider, request, env);
  }

  const stateCookie = getCookie(request, oauthStateCookieName(provider));
  if (!stateCookie) {
    return redirectLoginError(origin, provider, request, env);
  }

  const parsed = decodeOAuthStateCookieValue(stateCookie);
  if (!parsed || parsed.provider !== provider || !safeStateEqual(parsed.state, returnedState)) {
    return redirectLoginError(origin, provider, request, env);
  }

  const config = loadOAuthProviderConfig(provider, env, redirectUri);
  if (!config) {
    return new Response(`El proveedor OAuth "${provider}" no está configurado en este despliegue.`, {
      status: 404,
      headers: { "Set-Cookie": clearOAuthStateCookie(provider, request, env) },
    });
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(config, code, parsed.pkceVerifier);
  } catch (err) {
    console.error(`[Portaless OAuth] Fallo el intercambio con ${provider}:`, err);
    return redirectLoginError(origin, provider, request, env);
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
    return redirectLoginError(origin, provider, request, env);
  }

  const headers = new Headers({ Location: new URL("/admin", origin).toString() });
  headers.append("Set-Cookie", sessionCookie(result.session.token, request, env));
  headers.append("Set-Cookie", clearOAuthStateCookie(provider, request, env));

  return new Response(null, { status: 302, headers });
}
