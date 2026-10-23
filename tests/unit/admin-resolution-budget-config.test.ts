import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as endpoint from "../../functions/admin/api/resolution-budget";
import { applySchema } from "../../scripts/setup.mjs";
import { migrateSqlite } from "../../packages/persistence-migrations/src/runner";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function dbPath() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-budget-api-"));
  dirs.push(dir);
  return join(dir, "portaless.sqlite");
}

function context(path: string, method: "GET" | "PUT", user: { username: string; role: string } | null, body?: unknown) {
  return {
    request: new Request("https://site.example/admin/api/resolution-budget", {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env: { PORTALESS_SQLITE_PATH: path },
    data: user ? { user } : {},
  } as any;
}

const admin = { username: "owner", role: "admin" };
const config = {
  version: 1,
  windowMs: 60_000,
  client: { attempts: 20, bytes: 8 * 1024 * 1024 },
  origin: { attempts: 8, bytes: 4 * 1024 * 1024 },
  maxBuckets: 4096,
  maxConcurrentTotal: 8,
  maxConcurrentPerClient: 4,
  maxConcurrentPerOrigin: 4,
};

describe("admin resolution-budget config API", () => {
  it("is admin-write-only, versioned with compare-and-set, and explicitly not yet effective", async () => {
    const path = dbPath();
    await applySchema(path, { quiet: true });
    await migrateSqlite(path);
    expect((await endpoint.onRequestGet(context(path, "GET", null))).status).toBe(401);
    expect((await endpoint.onRequestPut(context(path, "PUT", { username: "viewer", role: "viewer" }, { expectedRevision: null, config }))).status).toBe(403);

    const empty = await endpoint.onRequestGet(context(path, "GET", admin));
    expect(await empty.json()).toMatchObject({ config: null, revision: null, configured: false, effective: false, writable: true });

    const created = await endpoint.onRequestPut(context(path, "PUT", admin, { expectedRevision: null, config }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ ok: true, revision: 1, effective: false, activation: "pending_runtime_integration" });

    const updated = await endpoint.onRequestPut(context(path, "PUT", admin, { expectedRevision: 1, config: { ...config, client: { ...config.client, attempts: 25 } } }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ revision: 2, config: { client: { attempts: 25 } } });
    const stale = await endpoint.onRequestPut(context(path, "PUT", admin, { expectedRevision: 1, config }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("resolution_budget_config_conflict");
    const get = await endpoint.onRequestGet(context(path, "GET", admin));
    expect(await get.json()).toMatchObject({ revision: 2, effective: false, activation: "pending_runtime_integration" });
  });
});
