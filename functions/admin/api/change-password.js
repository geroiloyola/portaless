// POST /admin/api/change-password (v0.0.9.30)
// Cambio de contrasena estando logueado. Body:
//   { currentPassword, newPassword, totpCode? }
// Pasa por AuthService.changePassword(), que exige la contrasena actual y
// el codigo 2FA si el usuario lo tiene activo, y registra el evento en el
// historial (hora, IP, ubicacion aproximada).
// Minimo de 12 caracteres, igual que el primer admin de /setup (ADR-002).

import { AuthService } from "@portaless/auth/service";
import {
  createUsersStore,
  createSessionStore,
  createPasswordResetStore,
  createEmailStepUpStore,
} from "@portaless/auth/store-factory";
import { createPasswordEventStore, passwordEventContextFromRequest } from "@portaless/auth/password-events";
import { emitActivity } from "@portaless/dashboard/activity";
import {
  InvalidContentLengthError,
  InvalidJsonBodyError,
  readJsonBodyLimited,
  RequestBodyTooLargeError,
} from "../../_shared/read-body-limited.js";

const MIN_PASSWORD_LENGTH = 12;
const MAX_BODY_BYTES = 16 * 1024;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ success: false, error: "unauthenticated" }, 401);

  let body;
  try {
    body = await readJsonBodyLimited(request, MAX_BODY_BYTES, { requireObject: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ success: false, error: "request_too_large" }, 413);
    }
    if (error instanceof InvalidContentLengthError || error instanceof InvalidJsonBodyError) {
      return json({ success: false, error: "invalid_json_body" }, 400);
    }
    return json({ success: false, error: "invalid_json_body" }, 400);
  }

  const { currentPassword, newPassword, totpCode, emailToken, emailCode } = body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return json({ success: false, error: "Se requieren currentPassword y newPassword." }, 400);
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json({ success: false, error: `La contrasena nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
  }

  const emailStepUpStore = await createEmailStepUpStore(env);
  const auth = new AuthService(
    await createUsersStore(env),
    await createSessionStore(env),
    await createPasswordResetStore(env),
    await createPasswordEventStore(env),
    undefined,
    emailStepUpStore
  );
  const hasEmailStepUp = emailToken !== undefined || emailCode !== undefined;
  const result = await auth.changePassword(
    user.username,
    currentPassword,
    newPassword,
    typeof totpCode === "string" ? totpCode : undefined,
    passwordEventContextFromRequest(request, env),
    hasEmailStepUp
      ? {
          emailToken: typeof emailToken === "string" ? emailToken : undefined,
          emailCode: typeof emailCode === "string" ? emailCode : undefined,
        }
      : undefined
  );

  // Fase 10: feed de actividad. Se registra el cambio, nunca la contrasena.
  if (result.success) {
    await emitActivity(env, { kind: "password.changed", actor: user.username, subject: user.username });
  }

  return json(result, result.success ? 200 : 400);
}
