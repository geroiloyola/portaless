// A-04/A-02: protocolo confiable detras de TLS, cookie unica y PUBLIC_URL
// obligatoria en el arranque self-host.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSelfHostServer, resolveRequestProtocol, startSelfHostServer, validatePublicUrl } from "../../server/node-runtime.mjs";
import { isSecureRequest, sessionCookie } from "../../functions/_shared/request-security.js";

describe("request protocol behind trusted proxies", () => {
  it("trusts X-Forwarded-Proto only from a configured proxy", () => {
    expect(resolveRequestProtocol("127.0.0.1", "https", ["127.0.0.1"], "http://localhost:3000")).toBe("https");
    expect(resolveRequestProtocol("203.0.113.9", "https", ["127.0.0.1"], "http://localhost:3000")).toBe("http");
  });

  it("uses an https public URL even when the tunnel reaches Node over http", () => {
    expect(resolveRequestProtocol("127.0.0.1", "", [], "https://site.example")).toBe("https");
  });

  it("accepts only absolute http(s) public URLs without credentials", () => {
    expect(validatePublicUrl("https://site.example/base/")).toBe("https://site.example");
    expect(validatePublicUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validatePublicUrl("")).toBeNull();
    expect(validatePublicUrl("ftp://site.example")).toBeNull();
    expect(validatePublicUrl("https://user:pass@site.example")).toBeNull();
  });

  it("startSelfHostServer refuses to start without PORTALESS_PUBLIC_URL", async () => {
    await expect(startSelfHostServer({ env: { PORTALESS_SQLITE_PATH: "/tmp/portaless-unused.db" } }))
      .rejects.toThrow(/PORTALESS_PUBLIC_URL/);
  });

  it("the real Node runtime trusts X-Forwarded-Proto only from a trusted proxy", async () => {
    const root = mkdtempSync(join(tmpdir(), "portaless-proto-"));
    const functions = join(root, "functions");
    mkdirSync(functions, { recursive: true });
    writeFileSync(join(functions, "probe.js"), `
      export async function onRequestGet(c) {
        return Response.json({
          url: c.request.url,
          proto: c.request.headers.get("x-portaless-request-proto"),
          forwarded: c.request.headers.get("x-forwarded-proto"),
        });
      }
    `);
    const server = await createSelfHostServer({
      rootDir: root,
      functionsDir: functions,
      staticDir: join(root, "dist"),
      env: {
        PORTALESS_PUBLIC_URL: "http://localhost:3000",
        PORTALESS_TRUSTED_PROXIES: "127.0.0.1",
      },
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok());
    });
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const trusted = await (await fetch(`${base}/probe`, { headers: { "x-forwarded-proto": "https" } })).json();
      expect(trusted.url.startsWith("https://")).toBe(true);
      expect(trusted.proto).toBe("https");
      expect(trusted.forwarded).toBeNull();

      const spoofedInternal = await (await fetch(`${base}/probe`, {
        headers: { "x-forwarded-proto": "https", "x-portaless-request-proto": "http" },
      })).json();
      expect(spoofedInternal.url.startsWith("https://")).toBe(true);
      expect(spoofedInternal.proto).toBe("https");
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("session cookie", () => {
  it("always uses HttpOnly + SameSite=Strict and adds Secure behind TLS", () => {
    const https = new Request("https://site.example/admin/login");
    expect(sessionCookie("tok", https, {})).toBe(
      "portaless_session=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400; Secure"
    );
    const http = new Request("http://localhost:3000/admin/login");
    expect(sessionCookie("tok", http, {})).not.toContain("Secure");
    expect(sessionCookie("tok", http, {})).toContain("SameSite=Strict");
  });

  it("uses the runtime-computed protocol header only in the Node runtime", () => {
    const request = new Request("http://internal/admin/login", {
      headers: { "x-portaless-request-proto": "https" },
    });
    expect(isSecureRequest(request, { __PORTALESS_RUNTIME: "node" })).toBe(true);
    expect(isSecureRequest(request, {})).toBe(false);
  });
});
