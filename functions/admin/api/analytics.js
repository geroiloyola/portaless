// Endpoint admin de la configuracion de analytics (Phase 6 — publication
// maturity).
//
// GET  /admin/api/analytics -> { provider, id, scriptUrl, updatedAt? }
//      (sesion; /admin/analytics lo usa para pintar el formulario).
// PUT  /admin/api/analytics -> { provider, id?, scriptUrl? } -> la config
//      validada. provider "none" apaga el analytics y limpia las claves.
//      Un id o una URL invalidos responden 400 con la lista rejected --
//      nunca se guarda basura en silencio (mismo criterio que
//      sanitizeTokens en skin.js).
//
// Seguridad: sesion (context.data.user) + canWrite(role) server-side,
// igual que skin.js. El admin NUNCA puede guardar JavaScript: solo un
// proveedor de la lista, un id de sitio y (solo para "custom") un origen
// https. Lo que se emite en /api/analytics lo construye Portaless a partir
// de esos tres datos.

import {
  createSiteSettingsStore,
  getAnalyticsSettings,
  saveAnalyticsSettings,
  ANALYTICS_PROVIDERS,
} from "../../../packages/dashboard/src/site-settings/site-settings-store.ts";

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
  const settings = await getAnalyticsSettings(store);
  return json({ ...settings, available: ANALYTICS_PROVIDERS });
}

export async function onRequestPut(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!canWrite(user.role)) {
    return json({
      error: "forbidden",
      message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.`,
    }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body", message: "El cuerpo debe ser JSON valido." }, 400);
  }

  const store = await createSiteSettingsStore(env);
  const result = await saveAnalyticsSettings(store, body);
  if (result.rejected.length > 0) {
    return json({
      error: "invalid_analytics",
      message: `Valores invalidos: ${result.rejected.join(", ")}. El id es texto simple y el origen debe ser https.`,
    }, 400);
  }
  return json(result.settings);
}
