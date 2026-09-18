// Endpoint de votacion del trustScore de plugins: POST otorga UN voto (1-5)
// de un admin sobre un plugin especifico -- cierra el hueco documentado
// desde el PR #28: "UI de trustScore conectada a un flujo real de
// votacion (hoy solo se lee el promedio; no existe UI para votar)".
//
// Mismo patron de autenticacion/autorizacion que functions/admin/permissions/
// index.js: requiere sesion valida (context.data.user) y exige role==="admin"
// del lado del SERVIDOR. recordVote() ya existia desde el PR #21
// (PluginRegistryStore.recordVote) pero ningun endpoint HTTP lo invocaba --
// este archivo cierra ese hueco, igual que index.js cerro el de lectura.
//
// Alcance de este voto: es la fuente "self"/admin sobre PLUGINS (trustScore
// de packages/plugin-sandbox/src/registry/plugin-registry.ts), NO el futuro
// SiteTrustScore de sitios completos (ese es un dominio distinto, ver
// packages/trust-layer -- documentado por separado).

import { createPluginRegistryStore } from "../../../../packages/plugin-sandbox/src/registry/store-factory.ts";

function canVote(role) {
  return role === "admin";
}

export async function onRequestPost(context) {
  const { request, data, env, params } = context;

  const user = data?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!canVote(user.role)) {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        message: `El rol '${user.role}' no tiene permiso para votar. Se requiere rol 'admin'.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const pluginId = params?.pluginId;
  if (!pluginId) {
    return new Response(JSON.stringify({ error: "missing_plugin_id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
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

  const { score, comment } = body ?? {};

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return new Response(
      JSON.stringify({
        error: "invalid_score",
        message: "Se requiere { score: 1-5 (entero), comment?: string }.",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const pluginRegistryStore = await createPluginRegistryStore(env);

  const existing = await pluginRegistryStore.get(pluginId);
  if (!existing) {
    return new Response(
      JSON.stringify({ error: "plugin_not_found", message: `Plugin "${pluginId}" no esta registrado.` }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  const updated = await pluginRegistryStore.recordVote({
    pluginId,
    voterId: user.username,
    score,
    comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
    votedAt: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      trustScore: updated.trustScore,
      trustScoreVotes: updated.trustScoreVotes,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
