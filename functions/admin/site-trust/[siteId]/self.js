// Endpoint ADMIN de autoevaluacion self sobre SiteTrustScore -- v0.0.9.16.
// PUT /admin/site-trust/:siteId/self declara UNA categoria de la fuente
// "self" (gdpr_compliance, privacy_policy, terms_of_service,
// payment_security, data_practices, contact_transparency -- ver
// docs/architecture/site-trust-score.md). Mismo patron de auth que
// functions/admin/permissions/index.js: requiere sesion valida
// (context.data.user, expuesta por functions/admin/_middleware.js) y
// exige rol "admin" del lado del SERVIDOR -- un viewer que llame este
// endpoint directamente, saltandose la UI, no puede escribir igual.
//
// A diferencia de community (voto anonimo de visitantes) y de agent/
// escrow_report (verificacion tecnica / reporte de un tercero, ninguno
// de los dos con mecanismo de auth implementado todavia -- ver
// limitaciones en docs/architecture/site-trust-score.md), self es
// declarativa: solo el propio admin del sitio puede declarar sobre su
// sitio, por eso exige la misma sesion admin que el Centro de Permisos.

import { createSiteTrustScoreStore } from "../../../../packages/trust-layer/src/site-trust/store-factory.ts";

const SELF_CATEGORIES = [
  "gdpr_compliance",
  "privacy_policy",
  "terms_of_service",
  "payment_security",
  "data_practices",
  "contact_transparency",
];

function canDeclare(role) {
  return role === "admin";
}

export async function onRequestPut(context) {
  const { request, data, env, params } = context;

  const user = data?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!canDeclare(user.role)) {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        message: `El rol '${user.role}' no tiene permiso para declarar. Se requiere rol 'admin'.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const siteId = params?.siteId;
  if (!siteId) {
    return new Response(JSON.stringify({ error: "missing_site_id" }), {
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

  const { category, declaredValue, evidenceUrl } = body ?? {};

  if (!SELF_CATEGORIES.includes(category)) {
    return new Response(
      JSON.stringify({
        error: "invalid_category",
        message: `category debe ser una de: ${SELF_CATEGORIES.join(", ")}.`,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (typeof declaredValue !== "boolean") {
    return new Response(
      JSON.stringify({ error: "invalid_declared_value", message: "declaredValue debe ser boolean." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createSiteTrustScoreStore(env);

  await store.recordSelfEvaluation({
    siteId,
    category,
    declaredValue,
    evidenceUrl: typeof evidenceUrl === "string" && evidenceUrl.trim() ? evidenceUrl.trim() : undefined,
    declaredBy: user.username,
    declaredAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
