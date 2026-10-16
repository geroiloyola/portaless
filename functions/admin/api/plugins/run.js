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
//   - El codigo NUNCA viene del request. Precedencia (§14.1):
//       1. `PluginArtifactStore` (`plugin_artifacts` / `plugin_artifact_chunks`
//          en D1, SQLite o memoria): el artefacto instalado por HTTP viaja con
//          su `manifest` verificado y su `code_hash` SHA-256. Antes de ejecutar
//          se valida el manifiesto y se recalcula `sha256Hex(code) === codeHash`.
//          No usa `node:fs`, asi que corre igual en Cloudflare Pages (workerd)
//          y en self-host.
//       2. Fallback a disco (`PORTALESS_PLUGIN_DIR`, default
//          `packages/plugin-sandbox/examples`) para los plugins de ejemplo que
//          viven en el repo y no pasaron por el instalador HTTP. Un id con path
//          traversal o un `manifest.entry` con ".." se rechaza con 400.
//   - Capacidades: granted = Centro de Permisos INTERSECTADO con lo que
//     el manifiesto declara (regla v0.0.9.30, aplicada dentro de
//     runPluginInProduction).
//   - bridgeUrl se calcula del ORIGEN de esta request
//     (<origin>/api/internal/capability-bridge), no de un valor fijo:
//     el bootstrap edge vuelve al capability bridge de este mismo sitio.
//
// Limitaciones honestas:
//   - Si el plugin NO tiene artefacto guardado en `plugin_artifacts` y el
//     runtime no tiene filesystem (workerd), el fallback a disco responde
//     `503 plugin_source_backend_unavailable`. Con artefacto guardado no toca
//     el disco y el `503` desaparece.
//   - La ejecucion edge real (Cloudflare/Deno) sigue requiriendo credenciales
//     en env (PORTALESS_CLOUDFLARE_* / PORTALESS_DENO_*); sin ellas el
//     registry cae a isolated-vm, igual que el resto del sistema.

import { runPluginInProduction } from "../../../../packages/plugin-sandbox/src/runtime/production-plugin-runner.ts";
import { createPluginRegistryStore } from "../../../../packages/plugin-sandbox/src/registry/store-factory.ts";
import { createPluginArtifactStore, sha256Hex } from "../../../../packages/plugin-sandbox/src/registry/plugin-artifacts.ts";
import { validateManifest } from "../../../../packages/plugin-sandbox/src/manifest/manifest-schema.ts";

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const DEFAULT_PLUGIN_DIR = "packages/plugin-sandbox/examples";

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function canWrite(role) {
  return role === "admin";
}

/**
 * Intenta resolver `{ manifest, code }` desde `PluginArtifactStore` (§14.1).
 * Devuelve:
 *   - `null` si no hay ningun artefacto guardado para este plugin (cae a disco);
 *   - `{ manifest, code }` si el artefacto existe, trae manifiesto valido y su
 *     hash SHA-256 coincide con `meta.codeHash`;
 *   - `{ error, status, message }` si el artefacto existe pero le falta el
 *     manifiesto o falla la verificacion de integridad.
 */
async function loadPluginFromArtifact(env, entry) {
  const artifacts = await createPluginArtifactStore(env);
  const pluginId = entry.pluginId;
  const authorIsDid = typeof entry.author === "string" && entry.author.startsWith("did:apw:");

  let artifact = null;
  if (authorIsDid && typeof entry.version === "string" && entry.version.length > 0) {
    artifact = await artifacts.get(entry.author, pluginId, entry.version);
  }
  if (!artifact) {
    const all = await artifacts.list();
    const candidates = all.filter(
      (m) => m.name === pluginId && (!authorIsDid || m.publisher === entry.author)
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const latest = candidates[candidates.length - 1];
      artifact = await artifacts.get(latest.publisher, latest.name, latest.version);
    }
  }
  if (!artifact) return null;

  const manifest = artifact.meta.manifest;
  if (!manifest) {
    return {
      error: "artifact_manifest_missing",
      status: 409,
      message: `El artefacto guardado para '${pluginId}@${artifact.meta.version}' no incluye su manifiesto. Reinstalalo con el instalador HTTP.`,
    };
  }
  const validation = validateManifest(manifest);
  if (!validation.valid || manifest.name !== pluginId || manifest.version !== artifact.meta.version) {
    return {
      error: "invalid_manifest",
      status: 400,
      message: `El manifiesto guardado para '${pluginId}@${artifact.meta.version}' no es válido.`,
    };
  }

  const actualHash = await sha256Hex(artifact.code);
  if (actualHash !== artifact.meta.codeHash) {
    return {
      error: "artifact_integrity_failed",
      status: 409,
      message: `El código guardado para '${pluginId}@${artifact.meta.version}' no coincide con su hash SHA-256 registrado.`,
    };
  }

  const code = new TextDecoder().decode(artifact.code);
  return { manifest, code };
}

/**
 * Resuelve manifiesto + codigo de un plugin desde disco (solo Node).
 * Devuelve { manifest, code } o { error } con el codigo de fallo.
 */
async function loadPluginSourceFromDisk(env, pluginId, deps = {}) {
  if (!PLUGIN_ID_RE.test(pluginId)) return { error: "invalid_plugin_id" };
  if (deps?.noFs === true) return { error: "plugin_source_backend_unavailable" };

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

export async function onRequestPost(context, deps = {}) {
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

  const fromArtifact = await loadPluginFromArtifact(env, entry);
  if (fromArtifact?.error) {
    return json({ error: fromArtifact.error, message: fromArtifact.message }, fromArtifact.status ?? 409);
  }

  const source = fromArtifact ?? (await loadPluginSourceFromDisk(env, pluginId, deps));
  if (source.error) {
    const status = source.error === "plugin_source_backend_unavailable" ? 503 : 404;
    const message =
      source.error === "plugin_source_backend_unavailable"
        ? `El plugin '${pluginId}' no tiene artefacto guardado en plugin_artifacts y la carga desde disco solo esta disponible en el runtime Node (self-host). En Cloudflare Pages (workerd) instala el plugin con POST /admin/api/plugins/install.`
        : `No se encontraron artefacto guardado ni manifest.json/entry para '${pluginId}' en ${env.PORTALESS_PLUGIN_DIR || DEFAULT_PLUGIN_DIR}.`;
    return json({ error: source.error, message }, status);
  }

  // bridgeUrl por-request desde el origen real de esta llamada: el
  // bootstrap edge siempre vuelve al capability bridge del sitio que
  // ejecuto el plugin, aunque el sitio tenga varios origenes.
  const origin = new URL(request.url).origin;
  const bridgeUrl = `${origin}/api/internal/capability-bridge`;

  const result = await runPluginInProduction(
    env,
    {
      manifest: source.manifest,
      code: source.code,
      payload: body?.payload ?? null,
      bridgeUrl,
    },
    deps
  );

  return json(result, 200);
}
