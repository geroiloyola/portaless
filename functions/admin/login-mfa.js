// Cloudflare Pages Function -- segundo paso de login cuando el usuario
// tiene 2FA activo. POST /admin/login/mfa recibe { challengeToken, code }
// (challengeToken viene del mfaChallengeToken devuelto por /admin/login
// cuando AuthService.login() responde mfaRequired:true).
//
// NOTA DE INTEGRACION MANUAL: functions/admin/login.js (preexistente, no
// modificado en este PR porque no se pudo leer su contenido exacto por un
// bug del conector de GitHub) debe actualizarse para: (1) revisar si
// AuthService.login() devuelve mfaRequired:true, y en ese caso, en vez de
// fijar la cookie de sesion, redirigir a /admin/login-mfa?challenge=<token>
// en vez de tratarlo como error. Ver docs/architecture/authentication.md,
// seccion "2FA -- integracion pendiente con login.js".

import { AuthService } from "../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../packages/auth/src/store-factory.ts";

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

  const { challengeToken, code } = body || {};
  if (!challengeToken || !code) {
    return new Response(JSON.stringify({ success: false, error: "Faltan challengeToken o code." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const authService = new AuthService(usersStore, sessionStore);

  const result = await authService.completeMfaLogin(challengeToken, code);

  if (!result.success || !result.session) {
    return new Response(JSON.stringify({ success: false, error: result.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `portaless_session=${result.session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
  );

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
