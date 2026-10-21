import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import { onRequestGet, onRequestPost } from "../../functions/admin/api/backup.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function env() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-admin-backup-"));
  dirs.push(dir);
  const sqlitePath = join(dir, "canon.sqlite");
  await applySchema(sqlitePath, { quiet: true });
  return { PORTALESS_SQLITE_PATH: sqlitePath, PORTALESS_DATA_DIR: dir };
}

function ctx(user: any, env: any, body?: any) {
  return {
    data: { user },
    env,
    request: new Request("https://portaless.test/admin/api/backup", {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  } as never;
}

describe("C36 admin backup endpoint", () => {
  it("requires admin and never exports secrets from the endpoint", async () => {
    const envs = await env();
    expect((await onRequestGet(ctx(null, envs))).status).toBe(401);
    expect((await onRequestGet(ctx({ role: "viewer" }, envs))).status).toBe(403);
    const rejected = await onRequestPost(ctx({ role: "admin" }, envs, { includeSecrets: true }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: "secret_export_requires_cli" });
  });

  it("creates a verified backup and lists it", async () => {
    const envs = await env();
    const created = await onRequestPost(ctx({ role: "admin" }, envs, {}));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ ok: true, secrets: { included: false } });
    const list = await onRequestGet(ctx({ role: "admin" }, envs));
    const listed = await list.json();
    expect(listed.backups).toHaveLength(1);
    expect(listed.backups[0].database.sha256).toBe(body.database.sha256);
  });
});
