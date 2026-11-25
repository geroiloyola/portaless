import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSecurityHeaders, SECURITY_HEADERS } from "../../functions/_shared/security-headers.js";
import { onRequest } from "../../functions/_middleware.js";
import { createSelfHostServer } from "../../server/node-runtime.mjs";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

describe("A-07 security headers", () => {
  it("adds the policy without overwriting endpoint headers or Set-Cookie", async () => {
    const response = withSecurityHeaders(new Response("ok", {
      headers: { "x-custom": "keep", "set-cookie": "portaless_session=abc; Path=/", "content-type": "text/plain" },
    }));
    expect(response.headers.get("x-custom")).toBe("keep");
    expect(response.headers.get("set-cookie")).toContain("portaless_session=abc");
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-security-policy")).toBe(SECURITY_HEADERS["content-security-policy"]);
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("wraps the global middleware response (Cloudflare path)", async () => {
    const response = await onRequest({
      request: new Request("https://site.example/"),
      env: {},
      data: {},
      next: async () => new Response("next", { status: 200 }),
    } as any);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("the Node runtime applies headers to static responses", async () => {
    const root = mkdtempSync(join(tmpdir(), "portaless-headers-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const dist = join(root, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<h1>ok</h1>");
    const server = await createSelfHostServer({
      rootDir: root,
      functionsDir: join(root, "functions"),
      staticDir: dist,
      env: {},
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok());
    });
    cleanup.push(() => server.close());
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const response = await fetch(`${base}/`);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("Cloudflare _headers carries the exact same CSP policy with no unsafe-inline or unsafe-eval in script-src", () => {
    const headers = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
    const cspMatch = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m);
    expect(cspMatch).toBeTruthy();
    const staticCsp = cspMatch![1].trim();
    const runtimeCsp = SECURITY_HEADERS["content-security-policy"];
    expect(staticCsp).toBe(runtimeCsp);

    const scriptSrcMatch = runtimeCsp.match(/script-src\s+([^;]+)/);
    expect(scriptSrcMatch).toBeTruthy();
    const scriptSrc = scriptSrcMatch![1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'self'");

    const nodeRuntimeSrc = readFileSync(join(process.cwd(), "server", "node-runtime.mjs"), "utf8");
    expect(nodeRuntimeSrc).toContain("withSecurityHeaders");
    expect(nodeRuntimeSrc).not.toContain("'unsafe-inline'");
    expect(nodeRuntimeSrc).not.toContain("'unsafe-eval'");

    expect(headers).toContain("Strict-Transport-Security:");
    expect(headers).toContain("X-Frame-Options: DENY");
  });
});
