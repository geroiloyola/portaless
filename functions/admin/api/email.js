// Endpoint admin de la configuracion de email transaccional (TASK 5).
//
// GET  /admin/api/email -> { provider, templates, from, available }
//      (sesion; /admin/settings/email lo usa para pintar el formulario).
// PUT  /admin/api/email -> la config VALIDADA. provider "none" apaga el envio.
//      Un proveedor/plantilla/from invalidos responden 400 con la lista
//      rejected -- nunca se guarda basura en silencio.
//
// Seguridad: sesion (context.data.user) + canWrite(role) server-side, igual
// que analytics.js. El dueno configura que plantillas estan aprobadas y con que
// proveedor; un plugin solo puede pedir plantillas aprobadas (Delegacion Ciega,
// ver capability-backends.ts). El `from` lo inyecta el core; nunca lo elige el
// plugin.

import {
  createSiteSettingsStore,
} from "../../../packages/dashboard/src/site-settings/site-settings-store.ts";
import {
  emailSettingsToValues,
  parseEmailSettings,
  sanitizeEmailInput,
} from "../../../packages/dashboard/src/site-settings/email-config.ts";

const AVAILABLE = ["none", "webhook", "smtp"];

function canWrite(role) {
  return role === "admin";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return json({ error: "unauthenticated" }, 401);
  const store = await createSiteSettingsStore(env);
  const settings = await parseEmailSettings(store);
  return json({ ...settings, available: AVAILABLE });
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

  const result = sanitizeEmailInput(body);
  if (result.rejected.length > 0) {
    return json({
      error: "invalid_email_settings",
      message: `Valores invalidos: ${result.rejected.join(", ")}.`,
      rejected: result.rejected,
    }, 400);
  }

  const store = await createSiteSettingsStore(env);
  await store.setMany(emailSettingsToValues(result.settings));
  return json(result.settings);
}
