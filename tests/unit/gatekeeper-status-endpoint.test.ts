import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/admin/api/gatekeeper-status.js";

describe("GET /admin/api/gatekeeper-status", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await onRequestGet({ data: {}, env: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, error: "unauthenticated" });
  });

  it("reports safe defaults (off / none) without exposing secrets", async () => {
    const res = await onRequestGet({
      data: { user: { username: "admin", role: "admin" } },
      env: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      mode: "off",
      trustedProxy: "none",
      ipHmacSecretConfigured: false,
      enforceReady: true,
      governedPathsCount: 0,
      configError: null,
    });
  });

  it("reports enforce + cloudflare status and never leaks PORTALESS_IP_HMAC_SECRET", async () => {
    const secret = "super-secret-deployment-hmac-key-0123456789";
    const res = await onRequestGet({
      data: { user: { username: "admin", role: "admin" } },
      env: {
        ENABLE_TRUST_LAYER: "true",
        PORTALESS_GATEKEEPER_MODE: "enforce",
        PORTALESS_TRUSTED_PROXY: "cloudflare",
        PORTALESS_IP_HMAC_SECRET: secret,
        PORTALESS_GOVERNED_PATHS: "/api/private, /api/members",
        PORTALESS_EGRESS_BUDGET_PER_IP: "15",
      },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(secret);
    const body = JSON.parse(raw);
    expect(body).toMatchObject({
      ok: true,
      trustLayerEnabled: true,
      mode: "enforce",
      trustedProxy: "cloudflare",
      ipHmacSecretConfigured: true,
      enforceReady: true,
      governedPathsCount: 2,
      configError: null,
    });
    expect(body.egressBudgets.perIp).toBe(15);
  });

  it("reports invalid mode / missing enforce secret cleanly without throwing", async () => {
    const badMode = await onRequestGet({
      data: { user: { username: "admin", role: "admin" } },
      env: { PORTALESS_GATEKEEPER_MODE: "permissive" },
    });
    expect(badMode.status).toBe(200);
    expect(await badMode.json()).toMatchObject({
      ok: true,
      mode: "invalid",
      enforceReady: false,
      configError: "invalid_gatekeeper_mode",
    });

    const missingSecret = await onRequestGet({
      data: { user: { username: "admin", role: "admin" } },
      env: { PORTALESS_GATEKEEPER_MODE: "enforce" },
    });
    expect(missingSecret.status).toBe(200);
    expect(await missingSecret.json()).toMatchObject({
      ok: true,
      mode: "enforce",
      ipHmacSecretConfigured: false,
      enforceReady: false,
      configError: "missing_ip_hmac_secret",
    });
  });
});
