// Cloudflare Pages Function -- endpoint HTTP interno que expone
// CapabilityHostBridge sobre HTTP, para adaptadores edge (Cloudflare
// Workers for Platforms, Deno Deploy) que ejecutan el codigo del plugin
// FUERA de este proceso Node y por lo tanto no pueden invocar hostBridge
// in-process como hace NodeIsolatedVmAdapter.
//
// Contrato: packages/plugin-sandbox/src/types.ts ya define
// SandboxExecutionInput.bridgeUrl (agregado en v0.0.9.1) como la URL de
// este endpoint. Los adaptadores edge (deno-deploy.ts,
// cloudflare-workers-for-platforms.ts) obtienen un token efimero real via
// SandboxExecutionInput.issueCapabilityToken ANTES de construir el
// bootstrap que suben al proveedor; el codigo del plugin, corriendo
// remotamente, hace POST aqui por cada capacidad no-red que invoca.
//
// POST /api/internal/capability-bridge
// Body: { capability: CapabilityId, args: unknown }
// Respuesta 200: { result: unknown }
// Respuesta 401: { error: "..." } -- token ausente, no encontrado o vencido
// Respuesta 403: { error: "..." } -- capacidad no incluida en el snapshot del token
// Respuesta 501: { error: "..." } -- capacidad concedida pero sin handler real
//
// v0.0.9.26 -- FIX DE SEGURIDAD (hallazgo documentado en ROADMAP.md):
// este endpoint validaba el header Authorization contra un secreto
// MAESTRO fijo (env.PORTALESS_INTERNAL_BRIDGE_TOKEN), el mismo para
// absolutamente todos los plugins y todas las ejecuciones. Los
// adaptadores edge generaban su propio bridgeToken con Math.random() sin
// registrar nada server-side, asi que nunca coincidia con el secreto
// esperado -- toda llamada real desde un adaptador edge fallaba con 401.
// Ademas, inyectar el secreto maestro real en el bootstrap (la salida
// facil) hubiera expuesto la clave de TODO el sistema a codigo de
// terceros no confiable corriendo en infraestructura ajena.
//
// Se reemplaza por CapabilityTokenStore (D1/SQLite/memoria, ver
// packages/plugin-sandbox/src/registry/stores/capability-token-store.ts):
// cada token es efimero (TTL corto), emitido por ejecucion (no
// compartido entre plugins), y lleva un snapshot de que capacidades
// tenia concedidas el plugin al momento de emitirse -- por eso ya NO se
// vuelve a consultar PermissionStore aqui, y pluginName ya NO viene en
// el body (se deriva del token, para que un bootstrap comprometido no
// pueda mentir su propia identidad).

import { createCapabilityTokenStore } from "../../../packages/plugin-sandbox/src/registry/stores/capability-token-store-factory";
import {
  createCapabilityHostBridge,
  dispatchCapability,
} from "../../../packages/plugin-sandbox/src/capabilities/capability-backends";

// Frontera de seguridad: por el bridge solo pueden pedirse las capacidades
// NO-red de plugins (network:fetch lo maneja cada adaptador, y billing/trust
// no son capacidades de plugins). El backend real de cada una vive en
// capability-backends.ts; aca se valida la FORMA antes de enrutar.
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

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get("Authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/);
  const token = bearerMatch ? bearerMatch[1] : null;

  if (!token) {
    return new Response(JSON.stringify({ error: "No autorizado: falta el header Authorization." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenStore = await createCapabilityTokenStore(env);
  const validation = await tokenStore.validate(token);

  if (!validation.valid) {
    const reason = validation.reason === "expired" ? "El token expiro." : "El token no existe o ya fue invalidado.";
    return new Response(JSON.stringify({ error: `No autorizado: ${reason}` }), {
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

  const { capability, args } = body || {};
  if (!isSupportedCapability(capability)) {
    return new Response(JSON.stringify({ error: "capability invalida." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ya no se consulta PermissionStore aqui -- el snapshot de capacidades
  // concedidas viaja en el token mismo, congelado al momento de emitirse
  // (ver nota de diseño en capability-token-store.ts: evita una condicion
  // de carrera si un admin revoca un permiso a mitad de una ejecucion en
  // curso, y ahorra una consulta secundaria en cada invocacion).
  const granted = validation.grantedCapabilities.includes(capability);
  if (!granted) {
    return new Response(
      JSON.stringify({ error: `Capacidad '${capability}' no incluida en el token de '${validation.pluginName}'.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const bridge = createCapabilityHostBridge(env);
    const result = await dispatchCapability(capability, args, bridge, validation.pluginName);
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const code = err && err.code;
    const status =
      code === "NOT_CONFIGURED"
        ? 501
        : code === "STORAGE_INVALID_KEY"
          ? 400
          : code === "STORAGE_VALUE_TOO_LARGE" || code === "STORAGE_TOO_MANY_KEYS" || code === "STORAGE_QUOTA_EXCEEDED"
            ? 413
            : 500;
    return new Response(JSON.stringify({ error: err.message || "Error interno.", ...(code ? { code } : {}) }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
