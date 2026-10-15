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
//
// APW 6.5: los grants de subject "reader" (DID did:apw: de un lector) solo
// admiten la capacidad trust:read-governance-bypass -- la excepcion por
// lector de la politica de lectura. El DID se teclea (o se revoca) desde el
// Centro de Permisos: no hay "solicitud" que el lector pueda iniciar. Un DID
// mal formado o cualquier otra capacidad para un subject reader: 400.

import { createPermissionStore } from "../../../packages/permissions/src/store-factory.ts";
import {
  READER_SUBJECT_TYPE,
  isReaderDid,
  validateReaderGrant,
} from "../../../packages/permissions/src/reader-bypass.ts";
import { createPluginRegistryStore } from "../../../packages/plugin-sandbox/src/registry/store-factory.ts";
import { listPayPerCrawlProviders } from "../../../packages/trust-layer/src/billing/pay-per-crawl/resolve.ts";
import {
  BILLING_CAPABILITY,
  SETTLEMENT_SUBJECT_TYPE,
  isSettlementGrant,
} from "../../../packages/trust-layer/src/billing/pay-per-crawl/activation-service.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";
import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../packages/auth/src/store-factory.ts";

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
  const { data, env, request } = context;

  if (!data?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Content negotiation (mismo patron que functions/trust/[siteId].js):
  // un navegador (Accept: text/html) quiere la UI del Centro de Permisos,
  // y el fetch() de esa propia UI (Accept */*) sigue recibiendo el JSON de
  // abajo. Sin esto la Function ganaba al estatico en self-host y en
  // Cloudflare Pages (las funciones corren antes que los assets), asi que
  // /admin/permissions respondia JSON crudo y la pagina
  // src/pages/admin/permissions.astro -- que existe en dist/ -- era
  // inalcanzable para una persona. El shell se sirve via env.ASSETS
  // (binding existente en ambas plataformas). Si no hay binding, o el
  // shell no existe, se responde JSON como antes.
  const accept = request?.headers?.get?.("accept") || "";
  if (accept.includes("text/html") && env?.ASSETS) {
    const shellUrl = new URL(request.url);
    shellUrl.pathname = "/admin/permissions/";
    shellUrl.search = "";
    const shell = await env.ASSETS.fetch(shellUrl);
    if (shell.ok) {
      const html = await shell.text();
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
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

  // Step-up obligatorio (Fase 11.2): conceder site:admin a un plugin ya
  // instalado es una accion tan sensible como instalar. Una sesion robada sola
  // no debe poder cambiarla. Mismo patron que site-identity.js (rotate).
  const auth = new AuthService(await createUsersStore(env), await createSessionStore(env));
  const check = await auth.verifyStepUp(user.username, {
    password: typeof body?.password === "string" ? body.password : undefined,
    totpCode: typeof body?.totpCode === "string" ? body.totpCode : undefined,
  });
  if (!check.ok) {
    return new Response(
      JSON.stringify({
        error: "step_up_failed",
        reason: check.reason,
        message:
          check.reason === "totp_required"
            ? "Ingresa el codigo de tu app de 2FA para cambiar permisos."
            : "Verificacion reforzada fallida (contrasena/2FA) para cambiar permisos.",
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

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

  if (subject.type === READER_SUBJECT_TYPE) {
    const readerError = !isReaderDid(subject.id)
      ? `Subject 'reader' invalido: se espera un DID did:apw:<dominio>, recibido '${subject.id}'.`
      : validateReaderGrant(capabilityId);
    if (readerError) {
      return new Response(
        JSON.stringify({ error: "invalid_reader_grant", message: readerError }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
  }

  const store = await createPermissionStore(env);
  await store.setGrant({
    subject,
    capabilityId,
    granted,
    grantedBy: user.username,
  });

  // Fase 10: feed de actividad (un solo escritor). Se registra el cambio de
  // permiso, no el contenido de la concesion.
  await emitActivity(env, {
    kind: granted ? "permission.granted" : "permission.revoked",
    actor: user.username,
    subject: `${subject.type}:${subject.id}`,
    detail: capabilityId,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
