// Cloudflare Pages Function -- POST /admin/password-reset/request
// Inicia recuperacion de contrasena. Siempre responde 200 (nunca revela
// si el username/email existe -- mitigacion estandar de enumeracion de
// usuarios). El envio real del email con el link de reset queda fuera de
// alcance de v0.0.9.4 (ver ROADMAP.md): este endpoint genera y persiste
// el token, pero NO lo envia por ningun canal todavia -- en desarrollo/
// self-hosted sin proveedor de email configurado, el token se devuelve
// en la respuesta SOLO si env.PORTALESS_DEV_MODE==="1", para poder
// probar el flujo completo sin infraestructura de correo.
//
// Guardia de produccion: si PORTALESS_DEV_MODE="1" y NODE_ENV==="production",
// el arranque de este endpoint se rechaza explicitamente (500) en vez de
// devolver el token de reset en la respuesta HTTP. Esto evita que un despliegue
// mal configurado exponga tokens de recuperacion a cualquiera que llame al
// endpoint. Ver SECURITY.md.

import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createPasswordResetStore,
} from "../../../packages/auth/src/store-factory.ts";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (env.PORTALESS_DEV_MODE === "1" && env.NODE_ENV === "production") {
    console.error(
      "PORTALESS_DEV_MODE=1 detectado con NODE_ENV=production. " +
      "Esta combinacion expondria tokens de recuperacion de contraseña en la respuesta HTTP. " +
      "Arranque rechazado -- corrige la configuracion de entorno antes de desplegar."
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: "Configuración de entorno inválida para producción.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

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
