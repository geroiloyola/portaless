// GET /admin/api/password-events (v0.0.9.30)
// Historial de cambios de contrasena del usuario logueado: fecha, tipo
// (reset | change), IP, navegador y pais/ciudad aproximados. Nunca la
// contrasena. Cada usuario ve solo su propio historial.

import { createPasswordEventStore } from "../../../packages/auth/src/password-event-store.ts";

export async function onRequestGet(context) {
  const { data, env } = context;
  const user = data?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const store = await createPasswordEventStore(env);
  const events = await store.listForUser(user.username, 50);
  return new Response(JSON.stringify({ events }), { status: 200, headers: { "content-type": "application/json" } });
}
