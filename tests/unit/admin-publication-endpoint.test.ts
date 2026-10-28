import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { __resetPublicationRunStoreForTests } from "../../packages/deploy-engine/src/publication-store";
import { onRequestGet, onRequestPost, publicationChildEnv } from "../../functions/admin/api/publication.js";

const dirs: string[] = [];
afterEach(() => { __resetPublicationRunStoreForTests(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function envWithPublishedPage() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-publication-"));
  dirs.push(dir);
  const env: any = { PORTALESS_SQLITE_PATH: join(dir, "data.sqlite") };
  const pages = await createPageStore(env);
  await pages.save({ version: "0.1", slug: "home", title: "Home", status: "published", root: [] }, { expectedRevisionId: null, actor: "owner" });
  return env;
}

function context(user: any, env: any, body?: any) {
  return {
    data: { user },
    env,
    request: new Request("https://portaless.test/admin/api/publication?siteId=default", {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  } as never;
}

describe("C34 admin publication endpoint", () => {
  it("requires admin", async () => {
    const env = await envWithPublishedPage();
    expect((await onRequestGet(context(null, env))).status).toBe(401);
    expect((await onRequestGet(context({ role: "viewer" }, env))).status).toBe(403);
  });

  it("M-08: el hijo de publicacion recibe solo el env allowlisted", () => {
    const env = publicationChildEnv({
      PATH: "/usr/bin",
      PORTALESS_SQLITE_PATH: "/data/portaless.db",
      PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: "encryption-key",
      PUBLIC_SITE_MODE: "beta",
      PORTALESS_LOGIN_ATTEMPTS_PER_IP: "60",
      AWS_SECRET_ACCESS_KEY: "must-not-leak",
      OPENAI_API_KEY: "must-not-leak",
    }, { hash: "snapshot-hash", siteId: "default" });

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      PORTALESS_SQLITE_PATH: "/data/portaless.db",
      PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: "encryption-key",
      PUBLIC_SITE_MODE: "beta",
      PORTALESS_PUBLISH_SNAPSHOT: '{"hash":"snapshot-hash","siteId":"default"}',
    });
    expect(env.PORTALESS_LOGIN_ATTEMPTS_PER_IP).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("publishes the current approved snapshot, is idempotent, and exposes status", async () => {
    const env = await envWithPublishedPage();
    const runner = vi.fn(async ({ snapshot, mode }: any) => mode === "retire"
      ? { commitSha: "retire-1", pagesUrl: null }
      : { commitSha: `commit-${snapshot.hash.slice(-8)}`, pagesUrl: "https://example.test/" });
    env.__PORTALESS_PUBLISH_RUNNER = runner;

    const first = await onRequestPost(context({ role: "admin", username: "owner" }, env, { action: "publish" }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.run).toMatchObject({ status: "published", provider: "github-pages" });
    expect(runner).toHaveBeenCalledTimes(1);

    const second = await onRequestPost(context({ role: "admin", username: "owner" }, env, { action: "publish" }));
    const secondBody = await second.json();
    expect(secondBody.idempotent).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);

    const status = await onRequestGet(context({ role: "admin", username: "owner" }, env));
    const statusBody = await status.json();
    expect(statusBody.snapshot.revisionIds.home).toBeTruthy();
    expect(statusBody.published.commitSha).toBe(firstBody.run.commitSha);
  });

  it("unpublishes through the retire runner without changing the snapshot", async () => {
    const env = await envWithPublishedPage();
    const runner = vi.fn(async ({ mode }: any) => mode === "retire"
      ? { commitSha: "retire-1", pagesUrl: null }
      : { commitSha: "commit-1", pagesUrl: "https://example.test/" });
    env.__PORTALESS_PUBLISH_RUNNER = runner;
    await onRequestPost(context({ role: "admin" }, env, { action: "publish" }));
    const response = await onRequestPost(context({ role: "admin" }, env, { action: "unpublish" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run.status).toBe("unpublished");
    expect(runner).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "retire" }));
  });
});
