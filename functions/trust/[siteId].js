// Endpoint PUBLICO de lectura de SiteTrustScore -- v0.0.9.16.
// GET /trust/:siteId devuelve el snapshot completo de las 4 fuentes para
// un sitio. Sin auth: es exactamente el dato que Protocol APW
// (packages/apw-resolver/, hoy stub) y cualquier agente externo necesitan
// poder leer libremente al resolver un sitio via did:web -- igual que
// list_installed_plugins (packages/mcp-server/src/tools/list-installed-
// plugins.ts) no requiere capacidad porque es informativo, no una accion
// sobre un subject puntual. Ver docs/architecture/site-trust-score.md.
//
// v0.0.9.16: primera conexion HTTP real. Hasta ahora createSiteTrustScoreStore
// (packages/trust-layer/src/site-trust/store-factory.ts) tenia D1/SQLite
// completos pero ningun endpoint lo invocaba -- mismo hueco que
// functions/admin/permissions/index.js cerro para el Centro de Permisos
// en el PR #6, y que functions/admin/plugins/[pluginId]/vote.js cerro
// para el voto de plugins.

import { createSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/store-factory.ts";

export async function onRequestGet(context) {
  const { env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) {
    return new Response(JSON.stringify({ error: "missing_site_id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const store = await createSiteTrustScoreStore(env);
  const snapshot = await store.getSnapshot(siteId);

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
