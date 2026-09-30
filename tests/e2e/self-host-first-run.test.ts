import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import { createFirstRunService } from "../../server/first-run.mjs";

const repo = resolve(__dirname, "../..");
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function boot(root: string) {
  const functions = join(root, "functions");
  mkdirSync(join(functions, "api", "setup"), { recursive: true });
  for (const name of ["status", "complete"]) {
    writeFileSync(join(functions, "api", "setup", `${name}.js`), `export * from ${JSON.stringify(join(repo, "functions/api/setup", `${name}.js`))};`);
  }
  const data = join(root, "data");
  const sqlitePath = join(data, "portaless.db");
  const firstRun = createFirstRunService({ env: {}, sqlitePath, dataDir: data, log: () => {} });
  const { envPatch } = await firstRun.prepare();
  const server = await createSelfHostServer({ rootDir: root, functionsDir: functions, staticDir: join(root, "dist"), env: { PORTALESS_SQLITE_PATH: sqlitePath, ...envPatch, __PORTALESS_FIRST_RUN: firstRun } });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => ok()); });
  const address = server.address();
  cleanup.push(() => server.close());
  return { base: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, data, sqlitePath, envPatch };
}

const send = (base: string, body: unknown) =>
  fetch(base + "/api/setup/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("self-host first-run (SQLite real)", () => {
  it("SQLite vacio -> setup -> admin persistido -> reinicio conserva clave y bloquea otro setup", async () => {
    const root = mkdtempSync(join(tmpdir(), "portaless-first-run-e2e-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));

    const first = await boot(root);
    expect(await (await fetch(first.base + "/api/setup/status")).json()).toEqual({ needsSetup: true, keySourceWarning: true });
    const code = readFileSync(join(first.data, "SETUP_CODE.txt"), "utf-8").trim();

    expect((await send(first.base, { code: "ZZZZZZZZ", username: "admin", password: "una-contrasena-larga" })).status).toBe(403);
    const ok = await send(first.base, { code, username: "admin", password: "una-contrasena-larga" });
    expect(ok.status).toBe(201);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(first.sqlitePath, { readonly: true });
    expect(db.prepare("SELECT role FROM users WHERE username = ?").get("admin")).toEqual({ role: "admin" });
    db.close();

    expect((await fetch(first.base + "/api/setup/status").then((r) => r.json())).needsSetup).toBe(false);
    expect((await send(first.base, { code, username: "otro", password: "una-contrasena-larga" })).status).toBe(410);

    cleanup.pop()!();
    const second = await boot(root);
    expect(second.envPatch.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY).toBe(first.envPatch.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY);
    expect((await fetch(second.base + "/api/setup/status").then((r) => r.json())).needsSetup).toBe(false);
    expect((await send(second.base, { code, username: "otro", password: "una-contrasena-larga" })).status).toBe(410);
  });
});
