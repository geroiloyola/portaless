// Endpoint de administracion para la politica de acceso de agentes -- ROADMAP.md
// fase 12 (§12.1 + §12.2). GET devuelve la politica EFECTIVA y de donde sale
// (store / asset / default), porque el defecto que esta fase arregla es
// justamente no saber cual de los tres aplica: el dueno editaba el asset,
// redesplegaba, y no tenia forma de confirmar que la regla habia surtido
// efecto.
//
// Mismo patron de seguridad que functions/admin/api/authorized-agents.js:
// requiere sesion valida (context.data.user, de functions/admin/_middleware.js)
// para GET, y canWrite(role) del lado del SERVIDOR para PUT/DELETE. Un viewer
// que llame este endpoint con curl, saltandose la UI, no escribe igual.
//
// Step-up: NO se pide, a diferencia de PUT /admin/permissions. La diferencia es
// de naturaleza -- aca se edita la politica de contenido del PROPIO sitio, es
// reversible con el boton "restaurar" y no otorga ninguna capacidad a un
// tercero; un grant de capacidad si concede poder sobre recursos y por eso
// exige step-up. La decision queda escrita en el codigo para que un grant si
// la copie por inercia no.

// GET    /admin/api/agents -> { policy, source, updatedAt?, updatedBy?, writable }
// PUT    /admin/api/agents -> guarda el override (validado) en el store
// DELETE /admin/api/agents -> borra el override: vuelve a asset/default

import { createAgentAccessPolicyStore, validateAgentAccessPolicy, INVALID_AGENT_ACCESS_POLICY } from "../../../packages/trust-layer/src/policy/agent-access-store.ts";
import { resolveContentPolicy, CONTENT_POLICY_WELL_KNOWN_PATH } from "../../../packages/trust-layer/src/policy/load-policy.ts";
import { defaultContentPolicy } from "../../../packages/trust-layer/src/policy/manifest-schema.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";

function canWrite(role) {
  return role === "admin";
}

function unauthenticated() {
  return new Response(JSON.stringify({ error: "unauthenticated" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function forbidden(role) {
  return new Response(
    JSON.stringify({
      error: "forbidden",
      message: `El rol '${role}' no tiene permiso de escritura. Se requiere rol 'admin'.`,
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: "invalid_policy_body", message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

/** Las tres reglas en texto corto, para el feed: "search=allow ai_input=block ai_train=block". Sin el site ni nada controlable por el body. */
function describePolicy(policy) {
  const p = policy?.policies ?? {};
  const part = (k) => `${k}=${p[k]?.access ?? "?"}`;
  return `${part("search")} ${part("ai_input")} ${part("ai_train")}`;
}

export async function onRequestGet(context) {
  const { data, env, request } = context;
  const user = data?.user;
  if (!user) return unauthenticated();

  const store = await createAgentAccessPolicyStore(env);
  const origin = new URL(request.url).origin;
  const resolved = await resolveContentPolicy(origin, env?.ASSETS, store);

  return new Response(
    JSON.stringify({
      policy: resolved.policy,
      source: resolved.source,
      updatedAt: resolved.updatedAt ?? null,
      updatedBy: resolved.updatedBy ?? null,
      writable: canWrite(user.role),
      policyPath: CONTENT_POLICY_WELL_KNOWN_PATH,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

export async function onRequestPut(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return unauthenticated();
  if (!canWrite(user.role)) return forbidden(user.role);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Cuerpo JSON invalido.");
  }

  const origin = new URL(request.url).origin;
  // El sitio lo fija el servidor: un body con "site" de otro dominio no debe
  // poder publishar una politica que se presente como de este sitio.
  const candidate = { ...(body ?? {}), site: origin, version: "0.1" };

  if (!validateAgentAccessPolicy(candidate)) {
    return badRequest(
      `Politica invalida (${INVALID_AGENT_ACCESS_POLICY}). Se requieren las reglas search, ai_input y ai_train con access allow|charge|block, y si una regla es "charge" un price_usd mayor que 0.`
    );
  }

  const store = await createAgentAccessPolicyStore(env);
  try {
    const record = await store.write(candidate, user.username);
    // El razonamiento de "no step-up" (arriba) se apoya en que el cambio es
    // reversible Y auditable. Sin esta linea lo segundo era falso: un
    // ai_train block -> allow cambia la licencia de facto del contenido y
    // no quedaba registro de quien lo hizo.
    await emitActivity(env, {
      kind: "agents.policy_changed",
      actor: user.username,
      subject: describePolicy(record.policy),
      detail: "guardada en el panel",
    });
    return new Response(
      JSON.stringify({ ok: true, policy: record.policy, updatedAt: record.updatedAt, updatedBy: record.updatedBy, source: "store" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    if (err?.message === INVALID_AGENT_ACCESS_POLICY) {
      return badRequest(`Politica invalida (${INVALID_AGENT_ACCESS_POLICY}).`);
    }
    throw err;
  }
}

export async function onRequestDelete(context) {
  const { data, env } = context;
  const user = data?.user;
  if (!user) return unauthenticated();
  if (!canWrite(user.role)) return forbidden(user.role);

  const store = await createAgentAccessPolicyStore(env);
  // Se lee el override ANTES de borrarlo: el feed tiene que decir de que
  // politica se salio, no solo que se borro algo.
  const previous = await store.read();
  await store.clear();

  // Lo que queda despues de borrar el override: el asset si esta completo, el
  // default si no. Se devuelve para que el panel no tenga que adivinarlo.
  const origin = new URL(context.request.url).origin;
  const resolved = await resolveContentPolicy(origin, env?.ASSETS, store);

  if (previous) {
    await emitActivity(env, {
      kind: "agents.policy_changed",
      actor: user.username,
      subject: describePolicy(previous.policy),
      detail: `restaurado el valor de ${resolved.source === "asset" ? "el archivo" : "Portaless"}`,
    });
  }

  return new Response(
    JSON.stringify({ ok: true, policy: resolved.policy ?? defaultContentPolicy(origin), source: resolved.source }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
