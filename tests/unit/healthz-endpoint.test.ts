import { describe, expect, it, beforeEach } from "vitest";
import * as healthz from "../../functions/healthz.js";
import { onRequest, __resetMigrationGateForTests } from "../../functions/_middleware.js";

describe("functions/healthz.js (Cloudflare Pages liveness)", () => {
  it("GET responds 200 with constant body 'ok' and no-store headers", async () => {
    const res = await healthz.onRequestGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("ok");
  });

  it("HEAD responds 200 with empty body and no-store headers", async () => {
    const res = await healthz.onRequestHead();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("disallowed methods respond 405 with Allow: GET, HEAD", async () => {
    const res = await healthz.onRequest();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("functions/_middleware.js exact /healthz exemption", () => {
  beforeEach(() => {
    __resetMigrationGateForTests();
  });

  function callMiddleware(path: string, { method = "GET", ua = "UptimeRobot/2.0", trustLayer = "true" } = {}) {
    const request = new Request(`https://site.example${path}`, {
      method,
      headers: { "user-agent": ua },
    });
    const env = {
      ENABLE_TRUST_LAYER: trustLayer,
      PORTALESS_PUBLIC_URL: "https://site.example",
    };
    const next = async () => (method === "HEAD" ? healthz.onRequestHead() : healthz.onRequestGet());
    return onRequest({ request, env, params: {}, data: {}, next });
  }

  it("allows GET and HEAD /healthz for UptimeRobot and bot UAs with Trust Layer enabled", async () => {
    for (const ua of ["UptimeRobot/2.0", "Mozilla/5.0 (compatible; MonitorBot/1.0)", "curl-bot/1.0"]) {
      const getRes = await callMiddleware("/healthz", { method: "GET", ua, trustLayer: "true" });
      expect(getRes.status, `GET /healthz with ${ua}`).toBe(200);
      expect(await getRes.text()).toBe("ok");

      const headRes = await callMiddleware("/healthz", { method: "HEAD", ua, trustLayer: "true" });
      expect(headRes.status, `HEAD /healthz with ${ua}`).toBe(200);
      expect(await headRes.text()).toBe("");
    }
  });

  it("works identically when Trust Layer is disabled", async () => {
    const res = await callMiddleware("/healthz", { method: "GET", ua: "UptimeRobot/2.0", trustLayer: "false" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("does NOT exempt prefix-matching paths (/healthz-extra, /healthz/foo) when Trust Layer is enabled", async () => {
    for (const path of ["/healthz-extra", "/healthz/foo"]) {
      const res = await callMiddleware(path, { method: "GET", ua: "UptimeRobot/2.0", trustLayer: "true" });
      expect(res.status, path).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("unsigned_automated_request");
    }
  });
});
