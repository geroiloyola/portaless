// POST /admin/api/plugins/uninstall -- da de baja un plugin instalado (Fase 11.2).
//
// Detras del mismo flag que el instalador (`PORTALESS_PLUGIN_INSTALLER`), off por
// defecto: sin el, responde 404. Step-up obligatorio. Desinstalar borra el
// artefacto guardado, desactiva el registro y revoca los grants del plugin (la
// direccion segura: no dejar permisos de codigo que ya no esta).

import { createPluginArtifactStore } from "../../../../packages/plugin-sandbox/src/registry/plugin-artifacts.ts";
import { createPluginRegistryStore } from "../../../../packages/plugin-sandbox/src/registry/store-factory.ts";
import { createPermissionStore } from "../../../../packages/permissions/src/store-factory.ts";
import { AuthService } from "../../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../../packages/auth/src/store-factory.ts";
import { emitActivity } from "../../../../packages/dashboard/src/activity/activity-store.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installerEnabled(env) {
  const v = env?.PORTALESS_PLUGIN_INSTALLER;
  return v === true || v === "1" || v === "true";
}

export async function onRequestPost(context) {
  const { request, data, env } = context;

  if (!installerEnabled(env)) return json({ error: "not_found" }, 404);

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no puede desinstalar plugins. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const version = typeof body?.version === "string" ? body.version.trim() : "";
  if (!name || !version) {
    return json({ error: "invalid_body", message: "Se requieren { name, version }." }, 400);
  }

  const auth = new AuthService(await createUsersStore(env), await createSessionStore(env));
  const check = await auth.verifyStepUp(user.username, {
    password: typeof body?.password === "string" ? body.password : undefined,
    totpCode: typeof body?.totpCode === "string" ? body.totpCode : undefined,
  });
  if (!check.ok) return json({ error: "step_up_failed", reason: check.reason }, 401);

  const registry = await createPluginRegistryStore(env);
  const entry = await registry.get(name);
  const publisher = typeof body?.publisher === "string" && body.publisher ? body.publisher : entry?.author;
  if (!publisher) {
    return json({ error: "publisher_unknown", message: "No se pudo determinar el publicador; envía { publisher }." }, 400);
  }

  const artifacts = await createPluginArtifactStore(env);
  const removed = await artifacts.delete(publisher, name, version);

  if (entry) await registry.setActive(name, false);

  const permStore = await createPermissionStore(env);
  const subject = { type: "plugin", id: name, displayName: entry?.displayName ?? name };
  const granted = (await permStore.getGrantsFor(subject)).filter((g) => g.granted);
  for (const g of granted) {
    await permStore.setGrant({ subject, capabilityId: g.capabilityId, granted: false, grantedBy: user.username });
  }

  await emitActivity(env, { kind: "plugin.uninstalled", actor: user.username, subject: name, detail: version });

  return json({ ok: true, removed, revokedGrants: granted.map((g) => g.capabilityId) }, 200);
}
