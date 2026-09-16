// Cloudflare Pages Function -- endpoint HTTP interno que expone
// CapabilityHostBridge sobre HTTP, para adaptadores edge (Cloudflare
// Workers for Platforms, Deno Deploy) que ejecutan el codigo del plugin
// FUERA de este proceso Node y por lo tanto no pueden invocar hostBridge
// in-process como hace NodeIsolatedVmAdapter.
//
// Contrato: packages/plugin-sandbox/src/types.ts ya define
// SandboxExecutionInput.bridgeUrl (agregado en v0.0.9.1) como la URL de
// este endpoint. Los adaptadores edge (deno-deploy.ts,
// cloudflare-workers-for-platforms.ts) inyectan bridgeUrl en el bootstrap
// que suben al proveedor; el codigo del plugin, corriendo remotamente,
// hace POST aqui por cada capacidad no-red que invoca.
//
// POST /api/internal/capability-bridge
// Body: { capability: CapabilityId, pluginName: string, args: unknown }
// Respuesta 200: { result: unknown }
// Respuesta 403: { error: "..." } -- capacidad no concedida al plugin
// Respuesta 501: { error: "..." } -- capacidad concedida pero sin handler real
//
// SEGURIDAD: este endpoint NO debe exponerse publicamente sin autenticacion.
// Requiere el header Authorization: Bearer <PORTALESS_INTERNAL_BRIDGE_TOKEN>,
// un secreto compartido entre Portaless y el adaptador edge que lo invoca --
// nunca el mismo token que usan sesiones de usuario. Sin ese header valido,
// responde 401 antes de tocar cualquier capacidad.

import { createPermissionStore } from "../../../packages/permissions/src/store-factory";
import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory";

const SUPPORTED_CAPABILITIES = [
  "content:read",
  "content:write",
  "media:read",
  "media:write",
  "email:send",
  "commerce:read",
  "commerce:checkout",
  "storage:read",
  "storage:write",
  "agent:identify",
  "site:admin",
];

function isSupportedCapability(value) {
  return typeof value === "string" && SUPPORTED_CAPABILITIES.includes(value);
}

// Usa la interfaz real PermissionStore (packages/permissions/src/
// permission-store.ts): getGrantsFor(subject) devuelve PermissionGrant[]
// para ese subject -- no existe un isGranted() directo, asi que se busca
// el grant especifico por capabilityId dentro de esa lista. subject.type
// es siempre "plugin" aqui (mismo PermissionSubjectType que usa
// functions/admin/permissions/index.js para plugins ya instalados);
// displayName es obligatorio en PermissionSubject pero irrelevante para
// esta consulta de solo lectura, se usa pluginName como placeholder.
async function isCapabilityGranted(permissionStore, pluginName, capability) {
  const grants = await permissionStore.getGrantsFor({
    type: "plugin",
    id: pluginName,
    displayName: pluginName,
  });
  const grant = grants.find((g) => g.capabilityId === capability);
  return Boolean(grant && grant.granted);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get("Authorization") || "";
  const expectedToken = env.PORTALESS_INTERNAL_BRIDGE_TOKEN;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return new Response(JSON.stringify({ error: "No autorizado." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Cuerpo de la solicitud invalido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { capability, pluginName, args } = body || {};
  if (!isSupportedCapability(capability) || typeof pluginName !== "string") {
    return new Response(JSON.stringify({ error: "capability o pluginName invalidos." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const permissionStore = await createPermissionStore(env);
  const granted = await isCapabilityGranted(permissionStore, pluginName, capability);
  if (!granted) {
    return new Response(
      JSON.stringify({ error: `Capacidad '${capability}' no concedida a '${pluginName}'.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const result = await dispatchCapability(capability, args, env);
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err && err.code === "NOT_CONFIGURED" ? 501 : 500;
    return new Response(JSON.stringify({ error: err.message || "Error interno." }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Enruta cada capacidad al handler real disponible en este entorno.
// Mismo principio de "handler no configurado" que packages/plugin-sandbox/
// src/adapters/node-isolated-vm.ts (NOT_CONFIGURED): si la capacidad esta
// concedida pero no hay backend real conectado todavia, responde 501
// explicito en vez de fingir exito o tratarlo como denegado.
//
// content:read/content:write son las 2 unicas capacidades con backend real
// disponible hoy en este repo (PageStore, ya conectado desde v0.0.8/v0.0.9.4).
// Las 9 restantes (media, email, commerce, storage, agent:identify,
// site:admin) no tienen todavia un backend real -- mismo estado que
// documenta ROADMAP.md para NodeIsolatedVmAdapter.
async function dispatchCapability(capability, args, env) {
  switch (capability) {
    case "content:read": {
      const pageStore = await createPageStore(env);
      if (!args || typeof args.slug !== "string") {
        throw notConfigured("content:read requiere { slug: string }");
      }
      const layout = await pageStore.load(args.slug);
      if (!layout) throw notConfigured(`Pagina '${args.slug}' no encontrada.`);
      return layout;
    }
    case "content:write": {
      const pageStore = await createPageStore(env);
      if (!args || typeof args.slug !== "string") {
        throw notConfigured("content:write requiere un PageLayout completo con slug.");
      }
      await pageStore.save(args);
      return { success: true };
    }
    default:
      throw notConfigured(
        `Capacidad '${capability}' concedida, pero sin backend real conectado en este endpoint todavia.`
      );
  }
}

function notConfigured(message) {
  const err = new Error(message);
  err.code = "NOT_CONFIGURED";
  return err;
}
