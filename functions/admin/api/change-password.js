// POST /admin/api/change-password (v0.0.9.30)
// Cambio de contrasena estando logueado. Body:
//   { currentPassword, newPassword, totpCode? }
// Pasa por AuthService.changePassword(), que exige la contrasena actual y
// el codigo 2FA si el usuario lo tiene activo, y registra el evento en el
// historial (hora, IP, ubicacion aproximada).
// Minimo de 12 caracteres, igual que el primer admin de /setup (ADR-002).

import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore, createPasswordResetStore } from "../../../packages/auth/src/store-factory.ts";
import { createPasswordEventStore, passwordEventContextFromRequest } from "../../../packages/auth/src/password-event-store.ts";

const MIN_PASSWORD_LENGTH = 12;

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ success: false, error: "unauthenticated" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "invalid_json_body" }, 400);
  }

  const { currentPassword, newPassword, totpCode } = body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return json({ success: false, error: "Se requieren currentPassword y newPassword." }, 400);
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json({ success: false, error: `La contrasena nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
  }

  const auth = new AuthService(
    await createUsersStore(env),
    await createSessionStore(env),
    await createPasswordResetStore(env),
    await createPasswordEventStore(env)
  );
  const result = await auth.changePassword(
    user.username,
    currentPassword,
    newPassword,
    typeof totpCode === "string" ? totpCode : undefined,
    passwordEventContextFromRequest(request)
  );
  return json(result, result.success ? 200 : 400);
}
