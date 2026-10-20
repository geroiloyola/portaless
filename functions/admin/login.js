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
import { allowLoginAttempt, clearLoginFailures } from "../../packages/auth/src/login-rate-limit.ts";
import { clientIpFromHeaders } from "../../packages/auth/src/password-reset-rate-limit.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../_shared/read-body-limited.js";

export async function onRequestGet(context) {
  return context.next();
}

export async function onRequestPost(context) {
  const { request, env } = context;

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
  const rate = await allowLoginAttempt(rateLimitStore, clientIpFromHeaders(request.headers, env), username);
  if (!rate.allowed) {
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  const result = await authService.login(username, password);

  if (result.mfaRequired && result.mfaChallengeToken) {
    await clearLoginFailures(rateLimitStore, rate.buckets, rate.windowStart);
    const redirectUrl = new URL("/admin/login-mfa", request.url);
    redirectUrl.searchParams.set("challenge", result.mfaChallengeToken);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (!result.success || !result.session) {
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  await clearLoginFailures(rateLimitStore, rate.buckets, rate.windowStart);

  const isSecureContext = new URL(request.url).protocol === "https:";
  const cookieFlags = [
    `portaless_session=${result.session.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${24 * 60 * 60}`,
  ];
  if (isSecureContext) cookieFlags.push("Secure");

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookieFlags.join("; "),
      Location: new URL("/admin/", request.url).toString(),
    },
  });
}
