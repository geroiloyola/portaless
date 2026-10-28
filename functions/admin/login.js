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
import {
  recordLoginAttempt,
  loginAttemptLimit,
  recordLoginFailure,
  clearLoginFailures,
  loginRateLimitBuckets,
  LOGIN_WINDOW_MS,
} from "../../packages/auth/src/login-rate-limit.ts";
import { clientIpFromHeaders } from "../../packages/auth/src/password-reset-rate-limit.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../_shared/read-body-limited.js";
import { isTrustedRequestOrigin } from "../_shared/request-origin.js";
import { sessionCookie } from "../_shared/request-security.js";
import { LoginBusyError, runWithLoginConcurrency } from "../_shared/login-concurrency.js";

export async function onRequestGet(context) {
  return context.next();
}

function retryAfterSeconds(windowStart) {
  return Math.max(1, Math.ceil((windowStart + LOGIN_WINDOW_MS - Date.now()) / 1000));
}

function rateLimitedResponse(windowStart) {
  return new Response(JSON.stringify({ success: false, error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(windowStart)),
    },
  });
}

function serverBusyResponse() {
  return new Response(JSON.stringify({ success: false, error: "server_busy" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": "2",
    },
  });
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

  // Presupuesto barato de intentos por IP: se consulta ANTES de scrypt para que
  // un cliente ya bloqueado no siga consumiendo el hash caro. No cuenta fallos
  // ni usa el bucket de usuario, así que no reintroduce el lockout de A-01.
  const attempt = await recordLoginAttempt(rateLimitStore, clientIp, Date.now(), loginAttemptLimit(env));
  if (attempt.overLimit) return rateLimitedResponse(attempt.windowStart);

  // Verificar PRIMERO. Un fallo de terceros no puede bloquear una credencial
  // valida: el rate limit de fallos solo cuenta después de verificar.
  // El semáforo acota cuántos scrypt N=2^17 corren a la vez (memoria/CPU) y
  // rechaza con 503 cuando su cola acotada se llena o espera demasiado.
  let result;
  try {
    result = await runWithLoginConcurrency(env, () => authService.login(username, password));
  } catch (error) {
    if (error instanceof LoginBusyError) return serverBusyResponse();
    throw error;
  }

  if (result.mfaRequired && result.mfaChallengeToken) {
    const buckets = loginRateLimitBuckets(clientIp, username);
    await clearLoginFailures(rateLimitStore, buckets, Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS);
    const redirectUrl = new URL("/admin/login-mfa", request.url);
    redirectUrl.searchParams.set("challenge", result.mfaChallengeToken);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (!result.success || !result.session) {
    const state = await recordLoginFailure(rateLimitStore, clientIp, username);
    // Solo la IP rechaza. El bucket de usuario se registra para auditoría,
    // pero nunca bloquea: bloquear por usuario es el DoS original de A-01.
    if (state.ipOverLimit) return rateLimitedResponse(state.windowStart);
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
