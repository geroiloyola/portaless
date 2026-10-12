// Endpoint admin del skin activo (Phase 0 — visual identity foundation).
//
// GET  /admin/api/skin -> { skin, tokens, updatedAt, available, defaults }
//      (sesion; el selector de /admin/appearance lo usa para pintar el
//      formulario con lo que hay guardado).
// PUT  /admin/api/skin -> { skin?, tokens? } -> { skin, tokens,
//      updatedAt }. Reemplaza la configuracion (upsert). skin debe ser
//      uno de SKIN_NAMES; tokens pasa por sanitizeTokens() y una clave
//      invalida o insegura responde 400 invalid_tokens con la lista --
//      nunca se guarda basura en silencio.
//
// Seguridad: sesion (context.data.user) + canWrite(role) server-side,
// igual que cloud-images.js. Los tokens terminan en una hoja CSS
// publica (GET /api/site-skin), de ahi la barrera estricta de valores.

import {
  createSiteSkinStore,
  resolveActiveSkin,
  sanitizeTokens,
  isSkinName,
  SKIN_NAMES,
  SITE_ID,
} from "../../../packages/dashboard/src/skin-engine/site-skin-store.ts";
import { DEFAULT_TOKENS } from "../../../packages/dashboard/src/skin-engine/tokens.ts";

function canWrite(role) {
  return role === "admin";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return json({ error: "unauthenticated" }, 401);

  const store = await createSiteSkinStore(env);
  const record = await store.get(SITE_ID);
  const resolved = await resolveActiveSkin(record?.skin ?? "base", record?.tokens ?? {});
  return json({
    skin: record?.skin ?? "base",
    tokens: record?.tokens ?? {},
    // Valores efectivos (skin + overrides): el form pinta los color
    // inputs con esto y solo envia lo que el admin cambio respecto.
    resolved: resolved.light,
    updatedAt: record?.updatedAt ?? null,
    available: SKIN_NAMES,
    defaults: DEFAULT_TOKENS,
  });
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

  const store = await createSiteSkinStore(env);
  const current = await store.get(SITE_ID);

  const skin = body?.skin ?? current?.skin ?? "base";
  if (!isSkinName(skin)) {
    return json({ error: "invalid_skin", message: `Skin desconocido '${String(skin).slice(0, 40)}'. Disponibles: ${SKIN_NAMES.join(", ")}.` }, 400);
  }

  const { tokens, rejected } = sanitizeTokens(body?.tokens ?? current?.tokens ?? {});
  if (rejected.length > 0) {
    return json({ error: "invalid_tokens", message: `Claves de token invalidas o inseguras: ${rejected.join(", ")}.` }, 400);
  }

  const record = await store.set(SITE_ID, skin, tokens);
  const resolved = await resolveActiveSkin(record.skin, record.tokens);
  return json({
    skin: record.skin,
    tokens: record.tokens,
    updatedAt: record.updatedAt,
    preview: resolved,
  });
}
