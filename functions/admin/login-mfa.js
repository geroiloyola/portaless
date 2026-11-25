// Cloudflare Pages Function -- segundo paso de login cuando el usuario
// tiene 2FA activo. POST /admin/login-mfa recibe { challengeToken, code }
// (challengeToken viene del mfaChallengeToken devuelto por /admin/login
// cuando AuthService.login() responde mfaRequired:true; login.js redirige a
// /admin/login-mfa?challenge=<token>).
//
// Solo exporta POST: GET /admin/login-mfa cae a la pagina estatica
// (src/pages/admin/login-mfa.astro), igual en Cloudflare Pages y en el runtime Node.
//
// La cookie lleva Secure solo en HTTPS, igual que login.js: en self-hosted por
// HTTP en una IP de red local el navegador descartaria una cookie Secure.
//
// El challenge se lee de createMfaChallengeStore(env), el mismo store donde
// login.js lo guardo. Los fallos se cuentan ahi (maximo MFA_MAX_ATTEMPTS),
// asi que repartir intentos entre isolates no saltea el limite.

import { AuthService } from "@portaless/auth/service";
import {
  createUsersStore,
  createSessionStore,
  createMfaChallengeStore,
  createRateLimitStore,
} from "@portaless/auth/store-factory";
import {
  LOGIN_WINDOW_MS,
  mfaVerifyLimit,
  recordMfaVerifyAttempt,
} from "@portaless/auth/login-rate-limit";
import { clientIpFromHeaders } from "@portaless/auth/password-reset-rate-limit";
import {
  InvalidContentLengthError,
  InvalidJsonBodyError,
  readJsonBodyLimited,
  RequestBodyTooLargeError,
} from "../_shared/read-body-limited.js";
import { isTrustedRequestOrigin } from "../_shared/request-origin.js";
import { sessionCookie } from "../_shared/request-security.js";

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function retryAfterSeconds(windowStart) {
  return Math.max(1, Math.ceil((windowStart + LOGIN_WINDOW_MS - Date.now()) / 1000));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return json({ success: false, error: "Origen de solicitud inválido." }, 403);
  }

  let body;
  try {
    body = await readJsonBodyLimited(request, 8 * 1024, { requireObject: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ success: false, error: "La solicitud supera el tamaño permitido." }, 413);
    }
    if (error instanceof InvalidContentLengthError || error instanceof InvalidJsonBodyError) {
      return json({ success: false, error: "Cuerpo de la solicitud inválido." }, 400);
    }
    return json({ success: false, error: "Cuerpo de la solicitud inválido." }, 400);
  }

  const { challengeToken, code } = body || {};
  if (typeof challengeToken !== "string" || !challengeToken || typeof code !== "string" || !code) {
    return json({ success: false, error: "Faltan challengeToken o code." }, 400);
  }

  // N-03: presupuesto dedicado por IP para verificacion de codigos MFA.
  const rateLimitStore = await createRateLimitStore(env);
  const clientIp = clientIpFromHeaders(request.headers, env);
  const mfaAttempt = await recordMfaVerifyAttempt(rateLimitStore, clientIp, Date.now(), mfaVerifyLimit(env));
  if (mfaAttempt.overLimit) {
    return json(
      { success: false, error: "rate_limited" },
      429,
      { "Retry-After": String(retryAfterSeconds(mfaAttempt.windowStart)) }
    );
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const mfaChallengeStore = await createMfaChallengeStore(env);
  const authService = new AuthService(usersStore, sessionStore, undefined, undefined, mfaChallengeStore);

  const result = await authService.completeMfaLogin(challengeToken, code);

  if (!result.success || !result.session) {
    return json({ success: false, error: result.error }, 401);
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", sessionCookie(result.session.token, request, env));

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
