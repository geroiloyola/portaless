// Cloudflare Pages Function -- POST /admin/password-reset/request
// Inicia recuperacion de contrasena. Siempre responde 200 (nunca revela
// si el username/email existe -- mitigacion estandar de enumeracion de
// usuarios). El envio real del email con el link de reset queda fuera de
// alcance de v0.0.9.4 (ver ROADMAP.md): este endpoint genera y persiste
// el token, pero NO lo envia por ningun canal todavia -- en desarrollo/
// self-hosted sin proveedor de email configurado, el token se devuelve
// en la respuesta SOLO si env.PORTALESS_DEV_MODE==="1", para poder
// probar el flujo completo sin infraestructura de correo.

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

  const { username } = body || {};
  if (!username) {
    return new Response(JSON.stringify({ success: false, error: "Falta username." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const passwordResetStore = await createPasswordResetStore(env);
  const authService = new AuthService(usersStore, sessionStore, passwordResetStore);

  const result = await authService.requestPasswordReset(username);

  const devToken = env.PORTALESS_DEV_MODE === "1" && result ? result.token : undefined;

  return new Response(JSON.stringify({ success: true, devToken }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
