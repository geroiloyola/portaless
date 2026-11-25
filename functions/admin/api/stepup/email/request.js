// POST /admin/api/stepup/email/request
// Emite un codigo OTP de step-up de un solo uso al email registrado del
// usuario autenticado (tabla `auth_email_stepup_codes`).
//
// Garantias de seguridad:
//   - Requiere sesion autenticada (context.data.user) + origen confiable (CSRF).
//   - Presupuesto por IP y por usuario (anti email-bombing): 429 + Retry-After.
//   - Si no hay backend de email configurado (webhook, SMTP o DEV_MODE), falla
//     explicito con 503 `email_backend_unavailable`.
//   - El codigo OTP NUNCA aparece en la respuesta HTTP ni en logs de este
//     endpoint; solo se devuelve el `token` opaco del challenge y `expiresAt`.

import { AuthService } from "@portaless/auth/service";
import {
  createUsersStore,
  createSessionStore,
  createRateLimitStore,
  createEmailStepUpStore,
} from "@portaless/auth/store-factory";
import { createEmailSender, EmailBackendUnavailableError } from "@portaless/auth/email-sender";
import {
  EMAIL_STEPUP_WINDOW_MS,
  emailStepUpLimits,
  recordEmailStepUpRequest,
} from "@portaless/auth/login-rate-limit";
import { clientIpFromHeaders } from "@portaless/auth/password-reset-rate-limit";
import { isTrustedRequestOrigin } from "../../../../_shared/request-origin.js";
import {
  InvalidContentLengthError,
  readBodyLimited,
  RequestBodyTooLargeError,
} from "../../../../_shared/read-body-limited.js";

const MAX_BODY_BYTES = 4 * 1024;

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function retryAfterSeconds(windowStart) {
  return Math.max(1, Math.ceil((windowStart + EMAIL_STEPUP_WINDOW_MS - Date.now()) / 1000));
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ ok: false, error: "unauthenticated" }, 401);

  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return json({ ok: false, error: "invalid_request_origin" }, 403);
  }

  try {
    await readBodyLimited(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "request_too_large" }, 413);
    }
    if (error instanceof InvalidContentLengthError) {
      return json({ ok: false, error: "invalid_content_length" }, 400);
    }
    return json({ ok: false, error: "invalid_request_body" }, 400);
  }

  const rateLimitStore = await createRateLimitStore(env);
  const clientIp = clientIpFromHeaders(request.headers, env);
  const rateState = await recordEmailStepUpRequest(
    rateLimitStore,
    clientIp,
    user.username,
    Date.now(),
    emailStepUpLimits(env)
  );
  if (rateState.overLimit) {
    return json(
      { ok: false, error: "rate_limited" },
      429,
      { "Retry-After": String(retryAfterSeconds(rateState.windowStart)) }
    );
  }

  let sender;
  try {
    sender = createEmailSender(env);
  } catch (error) {
    if (error instanceof EmailBackendUnavailableError) {
      return json(
        {
          ok: false,
          error: "email_backend_unavailable",
          message: "No hay backend de email configurado para step-up.",
        },
        503
      );
    }
    return json({ ok: false, error: "email_send_failed" }, 502);
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const emailStepUpStore = await createEmailStepUpStore(env);
  const auth = new AuthService(usersStore, sessionStore, undefined, undefined, undefined, emailStepUpStore);

  const result = await auth.requestEmailStepUpCode(user.username, emailStepUpStore, sender);
  if (!result.sent) {
    if (result.reason === "user_not_found") return json({ ok: false, error: "user_not_found" }, 404);
    if (result.reason === "user_has_no_email") {
      return json(
        { ok: false, error: "user_has_no_email", message: "Tu cuenta no tiene un email configurado." },
        400
      );
    }
    if (result.reason === "no_email_backend") {
      return json(
        {
          ok: false,
          error: "email_backend_unavailable",
          message: "No hay backend de email configurado para step-up.",
        },
        503
      );
    }
    return json({ ok: false, error: "email_send_failed" }, 502);
  }

  return json({ ok: true, token: result.token, expiresAt: result.expiresAt }, 200);
}
