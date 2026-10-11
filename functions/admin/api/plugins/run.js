// POST /admin/api/plugins/run -- caller de produccion del sandbox de
// plugins (v0.0.9.31). Ejecuta un plugin REGISTRADO y ACTIVO en el
// registro dinamico, con sus capacidades resueltas del Centro de
// Permisos, a traves de runPluginInProduction() (el ensamblaje completo:
// createSandboxRuntime() + adaptadores edge desde env + bridgeUrl por
// origen). Es el caller de produccion que ROADMAP.md tenia pendiente:
// hasta ahora el unico plugin en produccion (commerce) construia el
// adaptador isolated-vm a mano, sin pasar por el runtime ni emitir
// tokens HTTP.
//
// Seguridad (todas las capas, servidor-side):
//   - Sesion valida + rol admin (context.data.user del middleware
//     /admin/*; el check de rol se repite AQUI, no se confia en la UI).
//   - Solo plugins que existan en el PluginRegistryStore y esten
//     `active` -- un plugin dado de baja no se puede invocar.
//   - El codigo NUNCA viene del request: se carga de disco, de
//     PORTALESS_PLUGIN_DIR (default: packages/plugin-sandbox/examples,
//     donde vive el hello-plugin de ejemplo). Un id con path traversal
//     o un manifest.entry con ".." se rechaza con 400.
//   - Capacidades: granted = Centro de Permisos INTERSECTADO con lo que
//     el manifiesto declara (regla v0.0.9.30, aplicada dentro de
//     runPluginInProduction).
//   - bridgeUrl se calcula del ORIGEN de esta request
//     (<origin>/api/internal/capability-bridge), no de un valor fijo:
//     el bootstrap edge vuelve al capability bridge de este mismo sitio.
//
// Limitaciones honestas:
//   - El loader de codigo usa node:fs, asi que en Cloudflare Pages
//     (workerd, sin filesystem) responde 503
//     plugin_source_backend_unavailable. En self-host (Node runtime,
//     Docker, Railway/Render) funciona sin configurar nada.
//   - La ejecucion edge real (Cloudflare/Deno) sigue requer credenciales
//     en env (PORTALESS_CLOUDFLARE_* / PORTALESS_DENO_*); sin ellas el
//     registry cae a isolated-vm, igual que el resto del sistema.

import { runPluginInProduction } from "../../../../packages/plugin-sandbox/src/runtime/production-plugin-runner.ts";
import { createPluginRegistryStore } from "../../../../packages/plugin-sandbox/src/registry/store-factory.ts";

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const DEFAULT_PLUGIN_DIR = "packages/plugin-sandbox/examples";

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function canWrite(role) {
  return role === "admin";
}

/**
 * Resuelve manifiesto + codigo de un plugin desde disco (solo Node).
 * Devuelve { manifest, code } o { error } con el codigo de fallo.
 */
async function loadPluginSource(env, pluginId) {
  if (!PLUGIN_ID_RE.test(pluginId)) return { error: "invalid_plugin_id" };

  let fs, path;
  try {
    fs = await import("node:fs/promises");
    path = await import("node:path");
  } catch {
    return { error: "plugin_source_backend_unavailable" };
  }

  const baseDir = env.PORTALESS_PLUGIN_DIR || DEFAULT_PLUGIN_DIR;
  const baseResolved = path.resolve(baseDir);
  const pluginDir = path.resolve(baseDir, pluginId);
  // Defensa en profundidad: el resolver ya solo acepta ids limpios, pero
  // el prefijo se verifica igual -- un bug futuro en el regex no debe
  // poder leer fuera del directorio configurado.
  if (pluginDir !== baseResolved && !pluginDir.startsWith(baseResolved + path.sep)) {
    return { error: "invalid_plugin_id" };
  }

  let manifest;
  let code;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  } catch {
    return { error: "plugin_source_not_found" };
  }

  if (typeof manifest?.entry !== "string" || manifest.entry.length === 0) {
    return { error: "invalid_manifest" };
  }
  const entryPath = path.resolve(pluginDir, manifest.entry);
  if (!entryPath.startsWith(pluginDir + path.sep)) {
    return { error: "invalid_manifest" };
  }
  try {
    code = await fs.readFile(entryPath, "utf8");
  } catch {
    return { error: "plugin_source_not_found" };
  }

  return { manifest, code };
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  if (!data?.user) {
    return json({ error: "unauthenticated" }, 401);
  }
  if (!canWrite(data.user.role)) {
    return json({ error: "forbidden", message: `El rol '${data.user.role}' no puede ejecutar plugins. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body", message: "El cuerpo debe ser JSON con al menos { plugin }." }, 400);
  }
  const pluginId = body?.plugin;
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    return json({ error: "invalid_plugin", message: "Falta el campo 'plugin' (id del plugin registrado)." }, 400);
  }
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return json({ error: "invalid_plugin_id", message: "El id del plugin solo puede contener letras, números, punto, guion bajo o guion." }, 400);
  }

  // Solo plugins registrados y activos: el registro es la puerta de
  // entrada (v0.0.9.9) y aqui se convierte en la puerta de EJECUCION.
  const registryStore = await createPluginRegistryStore(env);
  const entry = await registryStore.get(pluginId);
  if (!entry) {
    return json({ error: "plugin_not_registered", message: `El plugin '${pluginId}' no esta en el registro.` }, 404);
  }
  if (!entry.active) {
    return json({ error: "plugin_inactive", message: `El plugin '${pluginId}' esta registrado pero inactivo.` }, 409);
  }

  const source = await loadPluginSource(env, pluginId);
  if (source.error) {
    const status = source.error === "plugin_source_backend_unavailable" ? 503 : 404;
    const message =
      source.error === "plugin_source_backend_unavailable"
        ? "La carga de codigo de plugins desde disco solo esta disponible en el runtime Node (self-host). En Cloudflare Pages (workerd) no hay filesystem."
        : `No se encontraron manifest.json/entry para '${pluginId}' en ${env.PORTALESS_PLUGIN_DIR || DEFAULT_PLUGIN_DIR}.`;
    return json({ error: source.error, message }, status);
  }

  // bridgeUrl por-request desde el origen real de esta llamada: el
  // bootstrap edge siempre vuelve al capability bridge del sitio que
  // ejecuto el plugin, aunque el sitio tenga varios origenes.
  const origin = new URL(request.url).origin;
  const bridgeUrl = `${origin}/api/internal/capability-bridge`;

  const result = await runPluginInProduction(env, {
    manifest: source.manifest,
    code: source.code,
    payload: body?.payload ?? null,
    bridgeUrl,
  });

  return json(result, 200);
}
