// PR H: env.ASSETS en el runtime Node (paridad con Cloudflare Pages), para
// que functions/_middleware.js lea el manifiesto publicado en self-host.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssetsBinding, createPinnedFetch, createSelfHostServer } from "../../server/node-runtime.mjs";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const MANIFEST = { version: "1", policies: { ai_input: { access: "charge", price_usd: 0.002, unit: "request" } } };

function fixture(middlewareSource: string) {
  const root = mkdtempSync(join(tmpdir(), "portaless-assets-"));
  const functions = join(root, "functions");
  const dist = join(root, "dist");
  mkdirSync(functions, { recursive: true });
  mkdirSync(join(dist, ".well-known"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, ".well-known", "portaless-content-policy.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(root, "secreto.txt"), "no-servir");
  writeFileSync(join(functions, "_middleware.js"), middlewareSource);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return { root, functions, dist };
}

async function listen(server: Awaited<ReturnType<typeof createSelfHostServer>>) {
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok());
  });
  const address = server.address();
  cleanup.push(() => server.close());
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const ECHO_MIDDLEWARE = `export async function onRequest(c) {
  if (new URL(c.request.url).pathname !== "/probe") return c.next();
  const res = await c.env.ASSETS.fetch(new URL("/.well-known/portaless-content-policy.json", c.request.url));
  return Response.json({ status: res.status, body: res.ok ? await res.json() : null, flag: c.env.ENABLE_TRUST_LAYER ?? null, hasAssets: "ASSETS" in c.env });
}`;

const DIRECTORY_FETCHER_MIDDLEWARE = `export async function onRequest(c) {
  if (new URL(c.request.url).pathname !== "/probe") return c.next();
  return Response.json({
    hasFetcher: typeof c.env.__PORTALESS_DIRECTORY_FETCHER === "function",
    hasLookup: typeof c.env.__PORTALESS_DNS_LOOKUP === "function",
  });
}`;

describe("env.ASSETS en el runtime Node", () => {
  it("inyecta el directory fetcher con DNS pinning en self-host (B5)", async () => {
    const paths = fixture(DIRECTORY_FETCHER_MIDDLEWARE);
    const server = await createSelfHostServer({ rootDir: paths.root, functionsDir: paths.functions, staticDir: paths.dist, env: {} });
    const base = await listen(server);

    expect(await (await fetch(base + "/probe")).json()).toEqual({ hasFetcher: true, hasLookup: true });
  });

  it("el middleware lee el manifiesto publicado y sigue viendo las demas variables", async () => {
    const paths = fixture(ECHO_MIDDLEWARE);
    const env: Record<string, string> = { ENABLE_TRUST_LAYER: "true" };
    const server = await createSelfHostServer({ rootDir: paths.root, functionsDir: paths.functions, staticDir: paths.dist, env });
    const base = await listen(server);

    const probe = await (await fetch(base + "/probe")).json();
    expect(probe).toEqual({ status: 200, body: MANIFEST, flag: "true", hasAssets: true });

    // No muta el env original.
    expect("ASSETS" in env).toBe(false);
    expect((await fetch(base + "/")).status).toBe(200);
  });

  it("createPinnedFetch conecta a la IP validada y conserva el hostname (B5)", async () => {
    const captured: Record<string, unknown> = {};
    const fakeRequest = (url: URL, options: any, callback: (res: any) => void) => {
      captured.hostname = url.hostname;
      captured.options = options;
      options.lookup(url.hostname, {}, (err: Error | null, address: string, family: number) => {
        captured.lookupError = err;
        captured.address = address;
        captured.family = family;
      });
      callback({ statusCode: 500, headers: {}, resume() {} });
      return { on() { return this; }, end() {} };
    };

    const res = await createPinnedFetch(fakeRequest as never)("https://directory.example/x", {}, "93.184.216.34");

    expect(res.status).toBe(500);
    expect(captured.hostname).toBe("directory.example");
    expect(captured.lookupError).toBeNull();
    expect(captured.address).toBe("93.184.216.34");
    expect(captured.family).toBe(4);
  });

  it("respeta un ASSETS provisto por la plataforma", async () => {
    const paths = fixture(ECHO_MIDDLEWARE);
    const custom = { fetch: async () => Response.json({ custom: true }) };
    const server = await createSelfHostServer({ rootDir: paths.root, functionsDir: paths.functions, staticDir: paths.dist, env: { ASSETS: custom } as never });
    const base = await listen(server);
    expect((await (await fetch(base + "/probe")).json()).body).toEqual({ custom: true });
  });

  it("createAssetsBinding: 404 real, traversal bloqueado y solo GET/HEAD", async () => {
    const paths = fixture(ECHO_MIDDLEWARE);
    const assets = createAssetsBinding(paths.dist);

    expect((await assets.fetch("https://site.example/.well-known/portaless-content-policy.json")).status).toBe(200);
    expect((await assets.fetch(new Request("https://site.example/.well-known/portaless-content-policy.json"))).status).toBe(200);
    expect((await assets.fetch("https://site.example/.well-known/no-existe.json")).status).toBe(404);
    expect([403, 404]).toContain((await assets.fetch("https://site.example/%2e%2e/secreto.txt")).status);
    expect((await assets.fetch("https://site.example/.well-known/portaless-content-policy.json", { method: "POST" })).status).toBe(405);
  });
});
