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

const MIN_PASSWORD_LENGTH = 12;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
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

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const passwordResetStore = await createPasswordResetStore(env);
  const passwordEventStore = await createPasswordEventStore(env);
  const authService = new AuthService(usersStore, sessionStore, passwordResetStore, passwordEventStore);

  const result = await authService.completePasswordReset(token, newPassword, passwordEventContextFromRequest(request));

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}
