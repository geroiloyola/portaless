// Endpoint admin del feed de actividad (Fase 10).
//
// GET /admin/api/recents -> { events: ActivityEvent[] } (mas reciente primero).
//
// Sesion bajo /admin/* (functions/admin/_middleware.js expone
// context.data.user). Este feed es ADMIN-ONLY por diseno: activity_events no
// guarda IPs ni datos sensibles, y NO se expone en ninguna superficie publica
// (ver activity-store.ts). Solo lectura: las filas se escriben con
// emitActivity() en cada punto de escritura, nunca desde aca.

import { createActivityStore } from "../../../packages/dashboard/src/activity/activity-store.ts";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const { data, env, request } = context;
  if (!data?.user) return json({ error: "unauthenticated" }, 401);

  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_LIMIT) : DEFAULT_LIMIT;

  const store = await createActivityStore(env);
  const events = await store.list(limit);
  return json({ events });
}
