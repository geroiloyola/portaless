// Cloudflare Pages Function que maneja el endpoint real de login.
// GET /admin/login -> deja pasar a la pagina estatica (login.astro).
// POST /admin/login -> valida credenciales y setea la cookie de sesion.
//
// v0.0.9.5: si AuthService.login() devuelve mfaRequired:true (usuario con
// 2FA activo), este endpoint ya NO lo trata como error generico -- redirige
// a /admin/login-mfa?challenge=<mfaChallengeToken> para que el usuario
// complete el segundo paso. Ver docs/architecture/authentication.md,
// seccion 2FA, y functions/admin/login-mfa.js (segundo paso).
//
// El challenge se guarda con createMfaChallengeStore(env) (D1/SQLite), asi
// login-mfa.js lo encuentra aunque la request siguiente caiga en otro isolate
// de Cloudflare o el self-host se haya reiniciado.

import { AuthService } from "../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createMfaChallengeStore,
  createRateLimitStore,
} from "../../packages/auth/src/store-factory.ts";
import { recordLoginFailure, clearLoginFailures, loginRateLimitBuckets, LOGIN_WINDOW_MS } from "../../packages/auth/src/login-rate-limit.ts";
import { clientIpFromHeaders } from "../../packages/auth/src/password-reset-rate-limit.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../_shared/read-body-limited.js";
import { isTrustedRequestOrigin } from "../_shared/request-origin.js";
import { sessionCookie } from "../_shared/request-security.js";

export async function onRequestGet(context) {
  return context.next();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return new Response(JSON.stringify({ success: false, error: "Origen de solicitud inválido." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const mfaChallengeStore = await createMfaChallengeStore(env);
  const authService = new AuthService(usersStore, sessionStore, undefined, undefined, mfaChallengeStore);

  let rawBody;
  try {
    rawBody = await readBodyLimited(request, 16 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
    }
    throw error;
  }
  const formData = new URLSearchParams(rawBody);
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password || username.length > 254 || password.length > 1024) {
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  const rateLimitStore = await createRateLimitStore(env);
  const clientIp = clientIpFromHeaders(request.headers, env);

  // Verificar PRIMERO. Un fallo de terceros no puede bloquear una credencial
  // valida: el rate limit solo cuenta fallos, nunca rechaza antes de verificar.
  const result = await authService.login(username, password);

  if (result.mfaRequired && result.mfaChallengeToken) {
    const buckets = loginRateLimitBuckets(clientIp, username);
    await clearLoginFailures(rateLimitStore, buckets, Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS);
    const redirectUrl = new URL("/admin/login-mfa", request.url);
    redirectUrl.searchParams.set("challenge", result.mfaChallengeToken);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (!result.success || !result.session) {
    await recordLoginFailure(rateLimitStore, clientIp, username);
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  const buckets = loginRateLimitBuckets(clientIp, username);
  await clearLoginFailures(rateLimitStore, buckets, Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS);

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": sessionCookie(result.session.token, request, env),
      Location: new URL("/admin/", request.url).toString(),
    },
  });
}
