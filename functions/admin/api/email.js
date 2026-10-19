// Endpoint admin de la configuracion de email transaccional (TASK 5).
//
// GET  /admin/api/email -> { provider, templates, from, available, hasCredential }
//      SOLO rol admin. El token/password NUNCA se devuelve: se reemplaza por
//      `hasCredential: boolean` (R3, review).
// PUT  /admin/api/email -> la config VALIDADA. provider "none" apaga el envio.
//      Un proveedor/plantilla/from invalidos responden 400 con la lista
//      rejected -- nunca se guarda basura en silencio.
//      El token es "write-only": si el body no lo trae (o viene vacio) se
//      CONSERVA el actual; `provider.clearCredential: true` lo borra.
//
// Seguridad: sesion (context.data.user) + canWrite(role) server-side en AMBOS
// metodos (la config incluye credenciales de infraestructura, no es dato del
// sitio). El dueno configura que plantillas estan aprobadas y con que proveedor;
// un plugin solo puede pedir plantillas aprobadas (Delegacion Ciega, ver
// capability-backends.ts). El `from` lo inyecta el core; nunca lo elige el
// plugin.

import {
  createSiteSettingsStore,
} from "../../../packages/dashboard/src/site-settings/site-settings-store.ts";
import {
  emailSettingsToValues,
  parseEmailSettings,
  sanitizeEmailInput,
} from "../../../packages/email-transport/src/config.ts";

const AVAILABLE = ["none", "webhook", "smtp"];

function canWrite(role) {
  return role === "admin";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Devuelve la config SIN el token; solo dice si hay uno guardado. */
function withoutCredential(settings) {
  const { token, ...provider } = settings.provider ?? {};
  return { ...settings, provider, hasCredential: Boolean(token), available: AVAILABLE };
}

export async function onRequestGet(context) {
  const { data, env } = context;
  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!canWrite(user.role)) {
    return json({ error: "forbidden", message: `El rol '${user.role}' no puede ver la configuración de email. Se requiere rol 'admin'.` }, 403);
  }
  const store = await createSiteSettingsStore(env);
  const settings = await parseEmailSettings(store);
  return json(withoutCredential(settings));
}

export async function onRequestPut(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!canWrite(user.role)) {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body", message: "El cuerpo debe ser JSON valido." }, 400);
  }

  const store = await createSiteSettingsStore(env);
  const current = await parseEmailSettings(store);

  // Token write-only: si no viene (o viene vacio) y no se pide borrar, se
  // conserva el actual. Asi el panel nunca necesita recibir la credencial.
  const incomingProvider = { ...(body?.provider ?? {}) };
  const wantsClear = incomingProvider.clearCredential === true;
  const hasNewToken = typeof incomingProvider.token === "string" && incomingProvider.token !== "";
  delete incomingProvider.clearCredential;
  if (!hasNewToken) {
    if (wantsClear) delete incomingProvider.token;
    else if (current.provider.token) incomingProvider.token = current.provider.token;
  }

  const result = sanitizeEmailInput({ ...body, provider: incomingProvider });
  if (result.rejected.length > 0) {
    return json({
      error: "invalid_email_settings",
      message: `Valores invalidos: ${result.rejected.join(", ")}.`,
      rejected: result.rejected,
    }, 400);
  }

  await store.setMany(emailSettingsToValues(result.settings));
  return json(withoutCredential(result.settings));
}

