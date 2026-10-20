// Cloudflare Pages Function -- POST /admin/password-reset/request
// Inicia recuperación de contraseña. Mantiene una respuesta genérica para no
// revelar si existe el usuario; en producción envía el enlace solo si hay email,
// proveedor configurado y PORTALESS_PUBLIC_URL confiable. El token dev se
// devuelve solo con PORTALESS_DEV_MODE fuera de producción.
//
// Guardia de produccion: si PORTALESS_DEV_MODE="1" y NODE_ENV==="production",
// el arranque de este endpoint se rechaza explicitamente (500) en vez de
// devolver el token de reset en la respuesta HTTP. Esto evita que un despliegue
// mal configurado exponga tokens de recuperacion a cualquiera que llame al
// endpoint. Ver SECURITY.md.
//
// Rate limit: 5 pedidos por IP y 3 por usuario por hora (ver
// packages/auth/src/password-reset-rate-limit.ts). Al pasarse se responde el
// mismo 200 que en un pedido valido, sin generar token.

import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createPasswordResetStore,
  createRateLimitStore,
} from "../../../packages/auth/src/store-factory.ts";
import {
  allowPasswordResetRequest,
  clientIpFromHeaders,
} from "../../../packages/auth/src/password-reset-rate-limit.ts";
import { createEmailSender } from "../../../packages/auth/src/email-sender.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../../_shared/read-body-limited.js";
import { isTrustedRequestOrigin } from "../../_shared/request-origin.js";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";
import { EmailSendError } from "../../../packages/email-transport/src/send.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function okResponse(devToken) {
  return new Response(JSON.stringify({ success: true, devToken }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function passwordResetUrl(env, token) {
  const configured = typeof env.PORTALESS_PUBLIC_URL === "string" ? env.PORTALESS_PUBLIC_URL.trim() : "";
  if (!configured) throw new Error("PORTALESS_PUBLIC_URL is required for password recovery email links.");
  const url = new URL(configured);
  const localDev = env.PORTALESS_DEV_MODE === "1" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(localDev && url.protocol === "http:"))) {
    throw new Error("PORTALESS_PUBLIC_URL must be an HTTPS base URL (HTTP is allowed only for local dev).");
  }
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname = `${prefix}/admin/password-reset`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", token);
  return url.toString();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return new Response(JSON.stringify({ success: false, error: "Origen de solicitud inválido." }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

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
        headers: JSON_HEADERS,
      }
    );
  }

  let body;
  try {
    body = JSON.parse(await readBodyLimited(request, 8 * 1024));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response(JSON.stringify({ success: false, error: "La solicitud supera el tamaño permitido." }), {
        status: 413,
        headers: JSON_HEADERS,
      });
    }
    return new Response(JSON.stringify({ success: false, error: "Cuerpo de la solicitud inválido." }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { username } = body || {};
  if (typeof username !== "string" || !username.trim()) {
    return new Response(JSON.stringify({ success: false, error: "Falta username." }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const rateLimits = await createRateLimitStore(env);
  const allowed = await allowPasswordResetRequest(rateLimits, clientIpFromHeaders(request.headers, env), username);
  if (!allowed) {
    return okResponse(undefined);
  }

  const usersStore = await createUsersStore(env);
  const user = await usersStore.findByUsername(username);

  // Development-only escape hatch remains explicit and is rejected in production above.
  if (env.PORTALESS_DEV_MODE === "1") {
    const authService = new AuthService(usersStore, await createSessionStore(env), await createPasswordResetStore(env));
    const result = await authService.requestPasswordReset(username);
    return okResponse(result?.token);
  }

  // Never create an undiscoverable reset token: production sends only when the
  // account has an address, a configured sender and a trusted public base URL.
  if (user?.email) {
    const resets = await createPasswordResetStore(env);
    let issued;
    let deliveryAttemptId;
    try {
      const sender = createEmailSender(env);
      const authService = new AuthService(usersStore, await createSessionStore(env), resets);
      issued = await authService.requestPasswordReset(username);
      if (issued) {
        deliveryAttemptId = globalThis.crypto.randomUUID();
        await sender.send({
          to: user.email,
          subject: "Portaless: recuperar contraseña",
          text:
            `Recibimos una solicitud para cambiar la contraseña de tu cuenta.\n\n` +
            `Abre este enlace en los próximos 30 minutos:\n${passwordResetUrl(env, issued.token)}\n\n` +
            `Si no solicitaste el cambio, ignora este mensaje.`,
        });
      }
    } catch (error) {
      const deliveryUnknown = error instanceof EmailSendError && error.deliveryOutcome === "unknown";
      if (issued?.token && !deliveryUnknown) await resets.delete(issued.token);
      if (deliveryUnknown && deliveryAttemptId) {
        await emitActivity(env, {
          kind: "email.delivery.reconciliation_pending",
          actor: "auth",
          subject: deliveryAttemptId,
          detail: "purpose=password-reset; provider acceptance unknown; reset token retained",
        });
      }
      if (deliveryUnknown) {
        console.warn(`Resultado de entrega de reset desconocido; token retenido para reconciliar intento ${deliveryAttemptId}.`);
      } else {
        console.error("El proveedor rechazó la entrega del correo de recuperación; token eliminado.", error instanceof Error ? error.message : "delivery rejected");
      }
    }
  }

  return okResponse(undefined);
}
