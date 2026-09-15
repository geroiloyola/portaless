// Endpoint del Centro de Permisos: GET /admin/permissions devuelve el
// snapshot completo de grants (subject x capability) + el catalogo de
// subjects conocidos (plugins reales del repo); PUT /admin/permissions
// otorga o revoca UN grant puntual.
//
// Mismo patron que functions/admin/pages/[slug].js: requiere sesion
// valida (context.data.user, expuesta por functions/admin/_middleware.js)
// y aplica canWrite(role) del lado del SERVIDOR para el PUT -- un viewer
// que llame este endpoint directamente con curl/fetch, saltandose la UI,
// no puede escribir igual.
//
// v0.0.9.2: primera conexion real. Antes, packages/permissions/src/
// store-factory.ts (createPermissionStore) existia con implementaciones
// D1/SQLite completas, pero ningun archivo del repo lo invocaba -- el
// Centro de Permisos corria efectivamente en memoria, sin persistencia,
// porque no habia ningun endpoint HTTP que lo conectara. Este archivo
// cierra ese hueco, igual que se hizo para PageStore en el PR #6.

import { createPermissionStore } from "../../../packages/permissions/src/store-factory.ts";

// Catalogo de subjects conocidos -- los plugins reales que existen en el
// repo hoy. En una version futura esto deberia derivarse dinamicamente de
// un registro de plugins instalados (ver packages/plugin-sandbox/src/
// manifest/manifest-loader.ts), pero ese registro todavia no persiste
// una lista de "plugins instalados en este sitio" en ningun store real --
// solo valida manifiestos que ya se le pasan en memoria. Hardcodear estos
// 2 subjects conocidos es preferible a mostrar el Centro de Permisos
// siempre vacio, y no bloquea agregar mas plugins a esta lista despues.
const KNOWN_SUBJECTS = [
  { type: "plugin", id: "hello-plugin", displayName: "Hello Plugin (demo)" },
  { type: "plugin", id: "commerce-plugin", displayName: "Commerce Plugin (Medusa/Mercur)" },
];

// Capacidades que cada subject conocido declara en su manifest.json real
// (ver packages/plugin-sandbox/examples/hello-plugin/manifest.json y
// packages/commerce-plugin/manifest.json) -- usadas solo para poblar el
// snapshot inicial con un grant "no concedido" por cada capacidad
// solicitada, si el store todavia no tiene ningun registro para ese
// subject. Una vez que el administrador toca un switch, el grant real
// pasa a vivir en el store persistente y esta lista deja de importar
// para ese subject+capability especifico.
const KNOWN_REQUESTED_CAPABILITIES = {
  "hello-plugin": ["network:fetch"],
  "commerce-plugin": ["network:fetch"],
};

function canWrite(role) {
  return role === "admin";
}

async function buildSnapshot(store) {
  const existingGrants = await store.getAllGrants();
  const existingKeys = new Set(
    existingGrants.map((g) => `${g.subject.type}:${g.subject.id}:${g.capabilityId}`)
  );

  const defaults = [];
  for (const subject of KNOWN_SUBJECTS) {
    const requested = KNOWN_REQUESTED_CAPABILITIES[subject.id] ?? [];
    for (const capabilityId of requested) {
      const key = `${subject.type}:${subject.id}:${capabilityId}`;
      if (!existingKeys.has(key)) {
        defaults.push({ subject, capabilityId, granted: false });
      }
    }
  }

  return [...existingGrants, ...defaults];
}

export async function onRequestGet(context) {
  const { data, env } = context;

  if (!data?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const store = await createPermissionStore(env);
  const grants = await buildSnapshot(store);

  return new Response(JSON.stringify({ grants }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPut(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!canWrite(user.role)) {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { subject, capabilityId, granted } = body ?? {};

  if (
    !subject ||
    typeof subject.type !== "string" ||
    typeof subject.id !== "string" ||
    typeof subject.displayName !== "string" ||
    typeof capabilityId !== "string" ||
    typeof granted !== "boolean"
  ) {
    return new Response(
      JSON.stringify({
        error: "invalid_grant_body",
        message: "Se requiere { subject: { type, id, displayName }, capabilityId, granted }.",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createPermissionStore(env);
  await store.setGrant({
    subject,
    capabilityId,
    granted,
    grantedBy: user.username,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
