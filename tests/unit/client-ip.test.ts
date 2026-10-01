// APW v1.2 (B8): IP del cliente en Cloudflare y en el runtime Node.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSelfHostServer, parseTrustedProxies, resolveClientIp } from "../../server/node-runtime.mjs";
import { getClientIp, NODE_CLIENT_IP_HEADER } from "../../packages/trust-layer/src/net/client-ip";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

describe("resolveClientIp", () => {
  it("sin proxies confiables usa siempre la IP del socket e ignora X-Forwarded-For", () => {
    expect(resolveClientIp("203.0.113.9", "1.2.3.4", [])).toBe("203.0.113.9");
    expect(resolveClientIp("::ffff:203.0.113.9", undefined, [])).toBe("203.0.113.9");
  });

  it("si el socket es un proxy confiable, toma la primera IP no confiable desde la derecha", () => {
    const trusted = parseTrustedProxies("10.0.0.1, 10.0.0.2");
    expect(resolveClientIp("10.0.0.1", "198.51.100.7", trusted)).toBe("198.51.100.7");
    expect(resolveClientIp("10.0.0.1", "6.6.6.6, 198.51.100.7, 10.0.0.2", trusted)).toBe("198.51.100.7");
    expect(resolveClientIp("10.0.0.1", "", trusted)).toBe("10.0.0.1");
  });

  it("si el socket no es un proxy confiable, X-Forwarded-For no cuenta aunque haya proxies configurados", () => {
    expect(resolveClientIp("203.0.113.9", "1.2.3.4", ["10.0.0.1"])).toBe("203.0.113.9");
  });

  it("sin IP de socket devuelve null", () => {
    expect(resolveClientIp(undefined, "1.2.3.4", [])).toBeNull();
  });
});

describe("getClientIp", () => {
  it("en Cloudflare lee CF-Connecting-IP y nunca el header interno", () => {
    const req = new Request("https://site.example/", { headers: { "CF-Connecting-IP": "203.0.113.5", [NODE_CLIENT_IP_HEADER]: "6.6.6.6" } });
    expect(getClientIp(req, {})).toBe("203.0.113.5");
  });

  it("en el runtime Node lee solo el header interno", () => {
    const req = new Request("https://site.example/", { headers: { "CF-Connecting-IP": "6.6.6.6", [NODE_CLIENT_IP_HEADER]: "203.0.113.5" } });
    expect(getClientIp(req, { __PORTALESS_RUNTIME: "node" })).toBe("203.0.113.5");
  });

  it("devuelve null si no hay IP", () => {
    expect(getClientIp(new Request("https://site.example/"), {})).toBeNull();
  });
});

describe("runtime Node: la IP llega a las Functions y no se puede falsificar", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "portaless-client-ip-"));
    const functions = join(root, "functions");
    mkdirSync(functions, { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(
      join(functions, "ip.js"),
      `export async function onRequestGet(c) { return Response.json({ ip: c.request.headers.get("${NODE_CLIENT_IP_HEADER}"), cf: c.request.headers.get("cf-connecting-ip"), runtime: c.env.__PORTALESS_RUNTIME ?? null }); }`
    );
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    return { root, functions, dist: join(root, "dist") };
  }

  async function listen(env: Record<string, string>) {
    const paths = fixture();
    const server = await createSelfHostServer({ rootDir: paths.root, functionsDir: paths.functions, staticDir: paths.dist, env });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok());
    });
    cleanup.push(() => server.close());
    const address = server.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }

  it("descarta CF-Connecting-IP y el header interno enviados por el cliente", async () => {
    const base = await listen({});
    const res = await fetch(base + "/ip", {
      headers: { "CF-Connecting-IP": "6.6.6.6", [NODE_CLIENT_IP_HEADER]: "6.6.6.6", "X-Forwarded-For": "6.6.6.6" },
    });
    expect(await res.json()).toEqual({ ip: "127.0.0.1", cf: null, runtime: "node" });
  });

  it("con el proxy como confiable usa X-Forwarded-For", async () => {
    const base = await listen({ PORTALESS_TRUSTED_PROXIES: "127.0.0.1" });
    const res = await fetch(base + "/ip", { headers: { "X-Forwarded-For": "198.51.100.7" } });
    expect((await res.json()).ip).toBe("198.51.100.7");
  });
});
