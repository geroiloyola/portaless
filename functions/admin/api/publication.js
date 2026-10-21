// Admin-only publication orchestration (C34).
// GET  /admin/api/publication?siteId=default
// POST /admin/api/publication  { action: "publish" | "retry" | "unpublish", runId? }
//
// The endpoint never runs a build in the edge runtime. Self-hosted Node uses
// the existing publish script through an injectable runner; Cloudflare returns
// an explicit 503 instead of pretending it can build.

import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory.ts";
import { createPublicationRunStore } from "../../../packages/deploy-engine/src/publication-store.ts";
import { createPublicationOrchestrator, PublicationError } from "../../../packages/deploy-engine/src/publication-orchestrator.ts";
import { snapshotFromLayouts } from "../../../packages/deploy-engine/src/publication-snapshot.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function auth(user) {
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  return null;
}

async function currentSnapshot(env, siteId) {
  const store = await createPageStore(env);
  const layouts = [];
  for (const slug of await store.list()) {
    const layout = await store.load(slug);
    if (layout) layouts.push(layout);
  }
  return snapshotFromLayouts(siteId, layouts);
}

function mapPublisherFailure(stderr) {
  if (/stale_publication_snapshot/.test(stderr)) return "stale_publication_snapshot";
  if (/GitHub no esta configurado|No hay un token de GitHub|No se pudo determinar el usuario/.test(stderr)) return "github_not_connected";
  if (/Falta PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY/.test(stderr)) return "encryption_key_missing";
  if (/Falta PORTALESS_SQLITE_PATH/.test(stderr)) return "sqlite_required";
  return "publish_failed";
}

async function runPublisher(env, snapshot, mode = "publish") {
  if (typeof env.__PORTALESS_PUBLISH_RUNNER === "function") {
    return env.__PORTALESS_PUBLISH_RUNNER({ snapshot, mode });
  }
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new PublicationError("build_runtime_unavailable", "This runtime cannot run a build; use self-hosted Node or run npm run publish.");
  }
  const { spawn } = await import("node:child_process");
  const root = process.cwd();
  const tsx = `${root}/node_modules/tsx/dist/cli.mjs`;
  const script = `${root}/scripts/publish-site.mjs`;
  const args = [tsx, script, ...(mode === "retire" ? ["--retire"] : [])];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      PORTALESS_PUBLISH_SNAPSHOT: JSON.stringify(snapshot),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const cap = (text, chunk) => (text + String(chunk)).slice(-32 * 1024);
  child.stdout.on("data", (chunk) => { stdout = cap(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = cap(stderr, chunk); });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new PublicationError(mapPublisherFailure(stderr), "Publication command failed.");
  const line = [...stdout.split("\n")].reverse().find((entry) => entry.startsWith("PORTALESS_PUBLISH_RESULT="));
  if (!line) return { commitSha: null, pagesUrl: null };
  try {
    const result = JSON.parse(line.slice("PORTALESS_PUBLISH_RESULT=".length));
    return {
      commitSha: typeof result.commitSha === "string" ? result.commitSha : null,
      pagesUrl: typeof result.pagesUrl === "string" ? result.pagesUrl : null,
    };
  } catch {
    return { commitSha: null, pagesUrl: null };
  }
}

export async function onRequestGet(context) {
  const { data, env, request } = context;
  const denied = auth(data?.user);
  if (denied) return denied;
  const siteId = new URL(request.url).searchParams.get("siteId") || "default";
  try {
    const store = await createPublicationRunStore(env ?? {});
    const orchestrator = createPublicationOrchestrator({
      store,
      provider: env.PORTALESS_PUBLISH_PROVIDER || "github-pages",
      publish: async () => ({ commitSha: null, pagesUrl: null }),
      retire: async () => ({ commitSha: null, pagesUrl: null }),
    });
    const [status, snapshot] = await Promise.all([orchestrator.status(siteId), currentSnapshot(env ?? {}, siteId)]);
    return json({ siteId, snapshot, latest: status.latest, published: status.published });
  } catch (err) {
    return json({ error: "publication_status_unavailable", message: err?.message ?? String(err) }, 503);
  }
}

export async function onRequestPost(context) {
  const { data, env, request } = context;
  const denied = auth(data?.user);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const siteId = typeof body?.siteId === "string" ? body.siteId : "default";
  const action = body?.action;
  if (!["publish", "retry", "unpublish"].includes(action)) return json({ error: "invalid_action" }, 400);
  const provider = env.PORTALESS_PUBLISH_PROVIDER || "github-pages";
  if (provider !== "github-pages" && typeof env.__PORTALESS_PUBLISH_RUNNER !== "function") {
    return json({ error: "provider_not_wired", message: "This provider is validated for onboarding but has no deployer wired yet; the snapshot identity is provider-independent." }, 501);
  }

  try {
    const store = await createPublicationRunStore(env ?? {});
    const orchestrator = createPublicationOrchestrator({
      store,
      provider: env.PORTALESS_PUBLISH_PROVIDER || "github-pages",
      publish: async (snapshot, stage) => {
        await stage("building");
        await stage("deploying");
        return runPublisher(env, snapshot, "publish");
      },
      retire: (run) => runPublisher(env, { siteId, revisionIds: run.revisionIds, hash: run.snapshotHash }, "retire"),
    });
    if (action === "unpublish") {
      const outcome = await orchestrator.unpublish(siteId);
      return json({ ok: true, ...outcome }, 200);
    }
    const snapshot = await currentSnapshot(env ?? {}, siteId);
    if (action === "retry") {
      if (typeof body.runId !== "string" || !body.runId) return json({ error: "invalid_run_id" }, 400);
      const outcome = await orchestrator.retry(siteId, body.runId, snapshot);
      return json({ ok: true, ...outcome }, 200);
    }
    const outcome = await orchestrator.publish(snapshot);
    return json({ ok: true, ...outcome }, 200);
  } catch (err) {
    if (err instanceof PublicationError) {
      const status = err.code === "stale_publication_snapshot" ? 409
        : err.code === "build_runtime_unavailable" ? 503
        : err.code === "snapshot_empty" ? 400
        : err.code === "publication_not_found" || err.code === "nothing_to_unpublish" ? 404
        : 502;
      return json({ error: err.code }, status);
    }
    return json({ error: "publication_failed" }, 502);
  }
}
