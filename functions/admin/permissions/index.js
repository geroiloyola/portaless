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
// v0.0.9.2: primera conexion real del PermissionStore (D1/SQLite).
// v0.0.9.10: el catalogo de subjects se deriva del plugin registry.
// v0.0.9.12: subjects "plugin" incluyen trustScore/trustScoreVotes.
//
// PR H: los grants de cobro (billing:* o subject settlement-provider) NO se
// escriben por este PUT: responde 409 requires_activation_flow. Solo
// POST /admin/settlement los escribe, despues de verificar las credenciales
// del proveedor. El snapshot incluye una fila por proveedor pay-per-crawl
// para que el Centro de Permisos la muestre.

import { createPermissionStore } from "../../../packages/permissions/src/store-factory.ts";
import { createPluginRegistryStore } from "../../../packages/plugin-sandbox/src/registry/store-factory.ts";
import { listPayPerCrawlProviders } from "../../../packages/trust-layer/src/billing/pay-per-crawl/resolve.ts";
import {
  BILLING_CAPABILITY,
  SETTLEMENT_SUBJECT_TYPE,
  isSettlementGrant,
} from "../../../packages/trust-layer/src/billing/pay-per-crawl/activation-service.ts";

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
    const requested = (plugin.requestedCapabilities ?? []).filter((c) => !isSettlementGrant("plugin", c));
    for (const capabilityId of requested) {
      const key = `${subject.type}:${subject.id}:${capabilityId}`;
      if (!existingKeys.has(key)) {
        defaults.push({ subject, capabilityId, granted: false });
      }
    }
  }

  for (const provider of listPayPerCrawlProviders()) {
    const key = `${SETTLEMENT_SUBJECT_TYPE}:${provider.id}:${BILLING_CAPABILITY}`;
    if (!existingKeys.has(key)) {
      defaults.push({
        subject: { type: SETTLEMENT_SUBJECT_TYPE, id: provider.id, displayName: provider.displayName },
        capabilityId: BILLING_CAPABILITY,
        granted: false,
      });
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

  if (isSettlementGrant(subject.type, capabilityId)) {
    return new Response(
      JSON.stringify({
        error: "requires_activation_flow",
        message: "Los cobros se activan desde /admin/settlement con credenciales verificadas del proveedor.",
      }),
      { status: 409, headers: { "content-type": "application/json" } }
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
