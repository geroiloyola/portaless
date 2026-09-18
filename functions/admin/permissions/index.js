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
//
// v0.0.9.10: el catalogo de subjects ya no esta hardcodeado -- se deriva
// de packages/plugin-sandbox/src/registry/plugin-registry.ts via
// createPluginRegistryStore(env).
//
// v0.0.9.12: cada subject de tipo "plugin" en el snapshot ahora incluye
// trustScore/trustScoreVotes (tomados directo de PluginRegistryEntry), para
// que permission-center-ui.ts pueda mostrar el rating estilo Trakt antes
// de que un admin conceda una capacidad. agent/theme no tienen trustScore
// -- esos campos quedan undefined para ellos, ver types.ts.

import { createPermissionStore } from "../../../packages/permissions/src/store-factory.ts";
import { createPluginRegistryStore } from "../../../packages/plugin-sandbox/src/registry/store-factory.ts";

function canWrite(role) {
  return role === "admin";
}

async function buildSnapshot(permissionStore, pluginRegistryStore) {
  const existingGrants = await permissionStore.getAllGrants();
  const existingKeys = new Set(
    existingGrants.map((g) => `${g.subject.type}:${g.subject.id}:${g.capabilityId}`)
  );

  const registeredPlugins = await pluginRegistryStore.list(false);
  const trustById = new Map(
    registeredPlugins.map((p) => [p.pluginId, { trustScore: p.trustScore, trustScoreVotes: p.trustScoreVotes }])
  );

  // Los grants ya existentes en el PermissionStore no traen trustScore
  // (ese store no sabe nada de plugins) -- se le anexa aca, cruzando por
  // subject.id, para que la UI tenga el dato sin importar si el grant es
  // nuevo (default) o ya estaba persistido.
  for (const grant of existingGrants) {
    if (grant.subject.type !== "plugin") continue;
    const trust = trustById.get(grant.subject.id);
    if (trust) {
      grant.subject.trustScore = trust.trustScore;
      grant.subject.trustScoreVotes = trust.trustScoreVotes;
    }
  }

  const defaults = [];
  for (const plugin of registeredPlugins) {
    const subject = {
      type: "plugin",
      id: plugin.pluginId,
      displayName: plugin.displayName,
      trustScore: plugin.trustScore,
      trustScoreVotes: plugin.trustScoreVotes,
    };
    const requested = plugin.requestedCapabilities ?? [];
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

  const permissionStore = await createPermissionStore(env);
  const pluginRegistryStore = await createPluginRegistryStore(env);
  const grants = await buildSnapshot(permissionStore, pluginRegistryStore);

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
