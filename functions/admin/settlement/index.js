// Activacion de proveedores pay-per-crawl (PR H).
//
// GET  /admin/settlement  -> estado por proveedor (sin secretos).
// POST /admin/settlement  -> { action: "activate", providerId, credentials,
//                              confirmOriginLocked: true, password, totpCode? }
//                         -> { action: "deactivate", providerId }
//
// Activar exige: rol admin, verificacion reforzada (contrasena + 2FA si el
// admin lo tiene, mismo AuthService.verifyStepUp que la rotacion de
// identidad), confirmar que el origen solo acepta trafico del proveedor
// (si no, cf-pay-per-crawl se puede falsificar), identidad APW del sitio y
// verifyActivation() OK. Recien ahi se escriben la activacion y el grant.

import { createPermissionStore } from "@portaless/permissions/store-factory";
import { createSiteIdentityStore } from "@portaless/trust-storage-adapters";
import { AuthService } from "@portaless/auth/service";
import {
  createUsersStore,
  createSessionStore,
  createEmailStepUpStore,
} from "@portaless/auth/store-factory";
import { createSettlementActivationStore } from "@portaless/trust-storage-adapters";
import { listPayPerCrawlProviders } from "@verared/trust-layer/billing";
import { encryptToken } from "@portaless/deploy-engine/token-crypto";
import {
  activateProvider,
  deactivateProvider,
  hostFromApwDomain,
} from "@verared/trust-layer/billing";
import {
  InvalidContentLengthError,
  InvalidJsonBodyError,
  readJsonBodyLimited,
  RequestBodyTooLargeError,
} from "../../_shared/read-body-limited.js";

const SITE_ID = "default";
const MAX_BODY_BYTES = 32 * 1024;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return json({ error: "unauthenticated" }, 401);

  const store = await createSettlementActivationStore(env);
  const identity = await (await createSiteIdentityStore(env)).get(SITE_ID);
  const providers = [];
  for (const p of listPayPerCrawlProviders()) {
    const activation = await store.get(p.id);
    providers.push({
      id: p.id,
      displayName: p.displayName,
      credentials: p.credentials.map(({ key, label, secret, help }) => ({ key, label, secret, help })),
      active: Boolean(activation),
      metadata: activation?.metadata ?? null,
      verifiedAt: activation?.verifiedAt ?? null,
      activatedBy: activation?.activatedBy ?? null,
    });
  }
  return json({ siteHost: hostFromApwDomain(identity?.domain), providers }, 200);
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no puede configurar cobros. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await readJsonBodyLimited(request, MAX_BODY_BYTES, { requireObject: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "request_too_large" }, 413);
    }
    if (error instanceof InvalidContentLengthError || error instanceof InvalidJsonBodyError) {
      return json({ error: "invalid_json_body" }, 400);
    }
    return json({ error: "invalid_json_body" }, 400);
  }
  const { action, providerId } = body ?? {};
  if (typeof providerId !== "string") return json({ error: "invalid_body", message: "Se requiere providerId." }, 400);

  const activationStore = await createSettlementActivationStore(env);
  const permissionStore = await createPermissionStore(env);

  if (action === "deactivate") {
    const out = await deactivateProvider(providerId, user.username, { activationStore, permissionStore });
    return out.ok ? json({ ok: true, providerId: out.providerId, active: false }, 200) : json({ error: out.error }, out.status);
  }

  if (action !== "activate") return json({ error: "invalid_action" }, 400);

  const { credentials, confirmOriginLocked, password, totpCode, emailToken, emailCode } = body;
  if (!credentials || typeof credentials !== "object" || Object.values(credentials).some((v) => typeof v !== "string")) {
    return json({ error: "invalid_body", message: "credentials debe ser un objeto de strings." }, 400);
  }
  if (confirmOriginLocked !== true) {
    return json({
      error: "origin_lock_not_confirmed",
      message: "Confirma que el origen solo acepta trafico del proveedor. Si se puede llegar sin pasar por el, cualquiera puede falsificar la senal de cobro.",
    }, 400);
  }

  const emailStepUpStore = await createEmailStepUpStore(env);
  const auth = new AuthService(
    await createUsersStore(env),
    await createSessionStore(env),
    undefined,
    undefined,
    undefined,
    emailStepUpStore
  );
  const stepUp = await auth.verifyStepUp(user.username, {
    password: typeof password === "string" ? password : undefined,
    totpCode: typeof totpCode === "string" ? totpCode : undefined,
    emailToken: typeof emailToken === "string" ? emailToken : undefined,
    emailCode: typeof emailCode === "string" ? emailCode : undefined,
  });
  if (!stepUp.ok) return json({ error: "step_up_failed", reason: stepUp.reason }, 401);

  const identity = await (await createSiteIdentityStore(env)).get(SITE_ID);
  const out = await activateProvider(providerId, credentials, user.username, {
    activationStore,
    permissionStore,
    encryptCredential: encryptToken,
    encryptionKey: env.PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY,
    siteHost: hostFromApwDomain(identity?.domain),
  });
  if (!out.ok) return json({ error: out.error, reason: out.reason }, out.status);
  return json({ ok: true, providerId: out.providerId, active: true, metadata: out.metadata }, 200);
}
