import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";

const repo = resolve(__dirname, "../..");
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "portaless-admin-paths-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const functions = join(root, "functions");
  const dist = join(root, "dist");
  for (const dir of ["admin/oauth/[provider]", "admin/password-reset"]) mkdirSync(join(functions, dir), { recursive: true });
  for (const dir of ["admin/login-mfa", "admin/password-reset", "admin/editor"]) mkdirSync(join(dist, dir), { recursive: true });
  // Middleware REAL de /admin (sin sesion valida en el store en memoria).
  writeFileSync(join(functions, "admin", "_middleware.js"), `export * from ${JSON.stringify(join(repo, "functions/admin/_middleware.js"))};`);
  writeFileSync(join(functions, "admin", "login-mfa.js"), `export async function onRequestPost() { return new Response("mfa-post", { status: 200 }); }`);
  writeFileSync(join(functions, "admin", "password-reset", "request.js"), `export async function onRequestPost() { return new Response("reset-post", { status: 200 }); }`);
  writeFileSync(join(functions, "admin", "oauth", "[provider]", "start.js"), `export async function onRequestGet(c) { return new Response("oauth-" + c.params.provider); }`);
  writeFileSync(join(dist, "admin", "index.html"), "panel");
  writeFileSync(join(dist, "admin", "login-mfa", "index.html"), "pagina-mfa");
  writeFileSync(join(dist, "admin", "password-reset", "index.html"), "pagina-reset");
  writeFileSync(join(dist, "admin", "editor", "index.html"), "editor");
  const server = await createSelfHostServer({ rootDir: root, functionsDir: functions, staticDir: dist, env: {} });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => ok()); });
  const address = server.address();
  cleanup.push(() => server.close());
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });

describe("rutas publicas de /admin con el middleware real", () => {
  it("sirve sin sesion las paginas y endpoints previos al login", async () => {
    const base = await boot();
    const mfaPage = await get(base + "/admin/login-mfa");
    expect(mfaPage.status).toBe(200);
    expect(await mfaPage.text()).toBe("pagina-mfa");
    expect(await (await get(base + "/admin/password-reset")).text()).toBe("pagina-reset");
    expect(await (await get(base + "/admin/login-mfa", { method: "POST" })).text()).toBe("mfa-post");
    expect(await (await get(base + "/admin/password-reset/request", { method: "POST" })).text()).toBe("reset-post");
    expect(await (await get(base + "/admin/oauth/github/start")).text()).toBe("oauth-github");
  });

  it("redirige a login las rutas protegidas sin sesion", async () => {
    const base = await boot();
    for (const path of ["/admin/", "/admin/editor", "/admin/oauth/../editor", "/admin/login-mfa-x"]) {
      const res = await get(base + path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(`${base}/admin/login?error=1`);
    }
  });

  it("sin archivo estatico, un metodo sin handler sigue devolviendo 405", async () => {
    const base = await boot();
    const res = await get(base + "/admin/password-reset/request");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
