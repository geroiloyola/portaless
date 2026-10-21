// Admin-only canonical backup export (C36). Node-only: the edge runtime cannot
// create a consistent SQLite backup, so it returns an explicit 501. The endpoint
// creates a verified backup under the node data directory and lists existing
// backups. Restore is deliberately CLI-only: it must stop the active writer.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function auth(user) {
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  return null;
}

function nodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

async function deps() {
  const [{ mkdir, readdir, readFile }, { dirname, join, resolve }, portability] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("../../../packages/portability/src/index.ts"),
  ]);
  return { mkdir, readdir, readFile, dirname, join, resolve, ...portability };
}

function dataDir(env, sqlitePath, dirname) {
  return env.PORTALESS_DATA_DIR || dirname(resolve(sqlitePath));
}

function publicManifest(manifest) {
  return {
    format: manifest.format,
    version: manifest.version,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.source.schemaVersion,
    database: { file: manifest.database.file, sha256: manifest.database.sha256, bytes: manifest.database.bytes },
    secrets: { included: manifest.secrets.included, keys: manifest.secrets.keys },
  };
}

export async function onRequestGet({ data, env }) {
  const denied = auth(data?.user);
  if (denied) return denied;
  if (!nodeRuntime()) return json({ error: "backup_runtime_unavailable" }, 501);
  if (!env?.PORTALESS_SQLITE_PATH) return json({ error: "sqlite_required" }, 501);
  const { mkdir, readdir, readFile, dirname, join, resolve } = await deps();
  const root = join(dataDir(env, env.PORTALESS_SQLITE_PATH, dirname), "backups");
  try {
    await mkdir(root, { recursive: true });
    const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    const backups = [];
    for (const id of dirs.slice(0, 20)) {
      try {
        const manifest = JSON.parse(await readFile(join(root, id, "manifest.json"), "utf8"));
        backups.push({ id, ...publicManifest(manifest) });
      } catch {
        // A partial directory is not a backup; do not claim it is one.
      }
    }
    return json({ backups });
  } catch (err) {
    return json({ error: "backup_list_unavailable", message: err?.message ?? String(err) }, 503);
  }
}

export async function onRequestPost({ data, env, request }) {
  const denied = auth(data?.user);
  if (denied) return denied;
  if (!nodeRuntime()) return json({ error: "backup_runtime_unavailable" }, 501);
  if (!env?.PORTALESS_SQLITE_PATH) return json({ error: "sqlite_required" }, 501);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  if (body?.includeSecrets === true) {
    return json({ error: "secret_export_requires_cli", message: "Use npm run backup -- --include-secrets on the node; the admin endpoint never exports secrets." }, 400);
  }
  const { createCanonicalBackup, verifyCanonicalBackup, dirname, join, resolve } = await deps();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = join(dataDir(env, env.PORTALESS_SQLITE_PATH, dirname), "backups");
  try {
    const result = await createCanonicalBackup({
      sqlitePath: env.PORTALESS_SQLITE_PATH,
      outputDir: join(root, stamp),
      includeSecrets: false,
      env,
    });
    await verifyCanonicalBackup(result.directory);
    return json({ ok: true, id: stamp, ...publicManifest(result.manifest) }, 201);
  } catch (err) {
    return json({ error: "backup_failed", message: err?.message ?? String(err) }, 500);
  }
}
