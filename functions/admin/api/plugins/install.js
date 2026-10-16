// POST /admin/api/plugins/install -- instalador HTTP de plugins (Fase 11.2).
//
// DETRAS DE UN FLAG, APAGADO POR DEFECTO. Instalar por HTTP trae codigo
// ejecutable, y la revision externa del sandbox (ROADMAP Phase 3 item 5) sigue
// pendiente: con `PORTALESS_PLUGIN_INSTALLER` sin activar, este endpoint responde
// 404 (no revela que existe). No se anuncia.
//
// Principios (decididos en el plan de Fase 11.2):
//   - INSTALAR NO CONCEDE NADA. El registro guarda el plugin, pero el grant
//     efectivo sigue siendo `concedido ∩ manifiesto`: las capacidades se
//     aprueban en el Centro de Permisos, aparte.
//   - Step-up obligatorio (password + TOTP): es la accion mas sensible.
//   - El manifiesto va FIRMADO por el publicador (did:apw); se verifica contra
//     su identidad RESUELTA (5.1), no contra un hash servido por el mismo.
//     La firma cubre `requestedCapabilities` (ERRATA E-15): si no, un
//     "manifiesto firmado" no impediria cambiar lo que el plugin pide.
//   - INMUTABILIDAD: reinstalar la MISMA (publisher, name, version) con bytes
//     distintos falla (409). Si no, el hash guardado no protege nada.
//   - Al ACTUALIZAR: las capacidades REMOVIDAS se podan (revocan) y las
//     AMPLIADAS NO se auto-conceden; vuelven a revision (reconcileGrants).
//   - El codigo se guarda troceado (BLOB), con tope declarado. Nunca base64.
//   - §14.1: el manifiesto verificado viaja con el artefacto en
//     `plugin_artifacts` y el registro conserva la `version` activa, de modo
//     que `POST /admin/api/plugins/run` lo ejecuta desde la base sin depender
//     del filesystem (cierra el 503 de workerd).

import { resolveApwIdentity } from "../../../../packages/apw-resolver/src/index.ts";
import { verifyPluginManifest } from "../../../../packages/apw-resolver/src/did-apw/plugin-manifest.ts";
import { validateManifest } from "../../../../packages/plugin-sandbox/src/manifest/manifest-schema.ts";
import { createPluginArtifactStore, sha256Hex, MAX_ARTIFACT_BYTES } from "../../../../packages/plugin-sandbox/src/registry/plugin-artifacts.ts";
import { createPluginRegistryStore } from "../../../../packages/plugin-sandbox/src/registry/store-factory.ts";
import { reconcileGrants } from "../../../../packages/plugin-sandbox/src/install/reconcile.ts";
import { createPermissionStore } from "../../../../packages/permissions/src/store-factory.ts";
import { AuthService } from "../../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../../packages/auth/src/store-factory.ts";
import { emitActivity } from "../../../../packages/dashboard/src/activity/activity-store.ts";

const APW_DID_PREFIX = "did:apw:";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installerEnabled(env) {
  const v = env?.PORTALESS_PLUGIN_INSTALLER;
  return v === true || v === "1" || v === "true";
}

function peekJwsPayload(jws) {
  const part = String(jws).split(".")[1];
  if (!part) return null;
  const base64 = part.split("-").join("+").split("_").join("/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function peekJwsKid(jws) {
  try {
    const part = String(jws).split(".")[0];
    const base64 = part.split("-").join("+").split("_").join("/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const header = JSON.parse(atob(padded));
    return typeof header?.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, data, env } = context;

  if (!installerEnabled(env)) {
    // Fail-closed y sin filtrar informacion: sin el flag, la ruta no existe.
    return json({ error: "not_found" }, 404);
  }

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no puede instalar plugins. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const jws = body?.manifest;
  const code = body?.code;
  const password = typeof body?.password === "string" ? body.password : undefined;
  const totpCode = typeof body?.totpCode === "string" ? body.totpCode : undefined;

  if (typeof jws !== "string" || !jws.trim()) {
    return json({ error: "missing_manifest", message: "Se requiere `manifest`: el JWS firmado por el publicador (did:apw)." }, 400);
  }
  if (typeof code !== "string" || code.length === 0) {
    return json({ error: "missing_code", message: "Se requiere `code` (el codigo del plugin)." }, 400);
  }

  // Step-up: una sesion robada sola no instala codigo ejecutable.
  const auth = new AuthService(await createUsersStore(env), await createSessionStore(env));
  const check = await auth.verifyStepUp(user.username, { password, totpCode });
  if (!check.ok) {
    return json({ error: "step_up_failed", reason: check.reason }, 401);
  }

  // Publicador: se lee del payload SIN verificar solo para saber a quien
  // resolver; la verificacion real es contra esa identidad resuelta.
  let publisher;
  try {
    publisher = peekJwsPayload(jws.trim())?.publisher;
  } catch {
    return json({ error: "malformed_manifest" }, 400);
  }
  if (typeof publisher !== "string" || !publisher.startsWith(APW_DID_PREFIX)) {
    return json({ error: "invalid_publisher", message: "`publisher` debe ser un did:apw:<dominio>." }, 400);
  }
  const publisherDomain = publisher.slice(APW_DID_PREFIX.length);

  const identity = await resolveApwIdentity(publisherDomain, fetch);
  if (!identity.verified || !identity.didDocument) {
    return json({ error: "publisher_unresolvable", reason: identity.reason }, 403);
  }
  const publicKeyJwk = identity.didDocument.verificationMethod?.[0]?.publicKeyJwk;
  const kid = peekJwsKid(jws.trim());
  if (!kid) return json({ error: "malformed_manifest" }, 400);

  const verified = await verifyPluginManifest(jws.trim(), { publicKeyJwk, kid, publisher: identity.did });
  if (!verified.ok) {
    return json({ error: "invalid_manifest_signature", reason: verified.reason }, 400);
  }

  const manifest = verified.document.manifest;
  const manifestPayload = {
    name: manifest.name,
    version: manifest.version,
    entry: manifest.entry,
    runtime: manifest.runtime,
    requestedCapabilities: manifest.requestedCapabilities,
    ...(typeof manifest.description === "string" && manifest.description.length > 0
      ? { description: manifest.description }
      : {}),
  };
  const validation = validateManifest(manifestPayload);
  if (!validation.valid) {
    return json({ error: "invalid_manifest", details: validation.errors }, 400);
  }

  const codeBytes = new TextEncoder().encode(code);
  if (codeBytes.byteLength > MAX_ARTIFACT_BYTES) {
    return json({ error: "artifact_too_large", message: `El codigo supera el tope de ${MAX_ARTIFACT_BYTES} bytes.` }, 413);
  }
  const codeHash = await sha256Hex(codeBytes);

  const artifacts = await createPluginArtifactStore(env);
  const existing = await artifacts.getMeta(identity.did, manifest.name, manifest.version);
  if (existing && existing.codeHash !== codeHash) {
    return json(
      {
        error: "immutable_version_conflict",
        message: "Esa (publisher, name, version) ya existe con otro hash de codigo. Publica una version nueva.",
      },
      409
    );
  }
  if (existing?.manifest && JSON.stringify(existing.manifest) !== JSON.stringify(manifestPayload)) {
    return json(
      {
        error: "immutable_version_conflict",
        message: "Esa (publisher, name, version) ya existe con otro manifiesto. Publica una version nueva.",
      },
      409
    );
  }

  await artifacts.put({
    publisher: identity.did,
    name: manifest.name,
    version: manifest.version,
    code: codeBytes,
    codeHash,
    manifest: manifestPayload,
  });

  const pluginId = manifest.name;
  const registry = await createPluginRegistryStore(env);
  const previous = await registry.get(pluginId);
  const nowIso = new Date().toISOString();
  await registry.register({
    pluginId,
    displayName: manifest.name,
    author: identity.did,
    version: manifest.version,
    sourceType: body?.sourceType === "open" ? "open" : "closed",
    requestedCapabilities: manifest.requestedCapabilities,
    registeredAt: previous?.registeredAt ?? nowIso,
    installedAt: nowIso,
    active: true,
  });

  // Reconciliacion: podar capacidades removidas, marcar las ampliadas para
  // revision. NUNCA auto-conceder.
  const permStore = await createPermissionStore(env);
  const subject = { type: "plugin", id: pluginId, displayName: manifest.name };
  const currentGrants = (await permStore.getGrantsFor(subject)).filter((g) => g.granted).map((g) => g.capabilityId);
  const reconcile = reconcileGrants(previous?.requestedCapabilities ?? [], manifest.requestedCapabilities, currentGrants);
  for (const capabilityId of reconcile.prune) {
    await permStore.setGrant({ subject, capabilityId, granted: false, grantedBy: user.username });
  }

  await emitActivity(env, {
    kind: "plugin.installed",
    actor: user.username,
    subject: pluginId,
    detail: `${identity.did}@${manifest.version}`,
  });

  return json(
    {
      ok: true,
      plugin: { pluginId, publisher: identity.did, name: manifest.name, version: manifest.version, codeHash },
      grants: { keep: reconcile.keep, pruned: reconcile.prune, needsReview: reconcile.needsReview },
    },
    200
  );
}
