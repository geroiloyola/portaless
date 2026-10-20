// Cloudflare Pages Function -- POST /admin/password-reset/confirm
// Completa la recuperacion de contrasena con el token emitido por
// /admin/password-reset/request.
//
// v0.0.9.30: registra el evento en el historial de contrasenas (hora, IP,
// user agent y pais/ciudad que informa Cloudflare). Nunca la contrasena.
// Minimo de 12 caracteres, igual que el primer admin de /setup (ADR-002).

import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createPasswordResetStore,
} from "../../../packages/auth/src/store-factory.ts";
import {
  createPasswordEventStore,
  passwordEventContextFromRequest,
} from "../../../packages/auth/src/password-event-store.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../../_shared/read-body-limited.js";
import { isTrustedRequestOrigin } from "../../_shared/request-origin.js";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return new Response(JSON.stringify({ success: false, error: "Origen de solicitud inválido." }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let body;
  try {
    body = JSON.parse(await readBodyLimited(request, 16 * 1024));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response(JSON.stringify({ success: false, error: "La solicitud supera el tamaño permitido." }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: false, error: "Cuerpo de la solicitud inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { token, newPassword } = body || {};
  if (!token || !newPassword) {
    return new Response(JSON.stringify({ success: false, error: "Faltan token o newPassword." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return new Response(
      JSON.stringify({ success: false, error: `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return new Response(JSON.stringify({ success: false, error: `La contraseña nueva no puede superar ${MAX_PASSWORD_LENGTH} caracteres.` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const passwordResetStore = await createPasswordResetStore(env);
  const passwordEventStore = await createPasswordEventStore(env);
  const authService = new AuthService(usersStore, sessionStore, passwordResetStore, passwordEventStore);

  const result = await authService.completePasswordReset(token, newPassword, passwordEventContextFromRequest(request, env));

  // Fase 10: feed de actividad. EN ESTA SUPERFICIE el usuario del reset no se
  // conoce (el token lo resuelve el AuthService por dentro), asi que NO se
  // inventa una identidad: actor null y subject "password-reset". El registro
  // autoritativo con el username es password_change_events (admin-only).
  if (result.success) {
    await emitActivity(env, { kind: "password.reset", actor: null, subject: "password-reset" });
  }

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}
