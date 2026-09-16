// Cloudflare Pages Function -- POST /admin/password-reset/confirm
// Completa la recuperacion de contrasena con el token emitido por
// /admin/password-reset/request.

import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createPasswordResetStore,
} from "../../../packages/auth/src/store-factory.ts";

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

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return new Response(
      JSON.stringify({ success: false, error: "La contraseña nueva debe tener al menos 8 caracteres." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const passwordResetStore = await createPasswordResetStore(env);
  const authService = new AuthService(usersStore, sessionStore, passwordResetStore);

  const result = await authService.completePasswordReset(token, newPassword);

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}
