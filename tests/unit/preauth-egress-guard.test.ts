// Bloque 1: Tests unitarios y adversariales del Pre-Auth Egress Guard.
// Cubre: cabeceras proxy falsificadas, HMAC sin fuga de IP cruda, thundering herd
// (25 concurrentes => 1 sola llamada), cuotas por IP/origen/global (429 + Retry-After)
// y eviccion acotada de cache (positivos y negativos).
import { describe, it, expect, vi } from "vitest";
import {
  createPreAuthEgressGuard,
  extractTrustedClientIp,
  GatekeeperConfigError,
  hashClientIp,
  rateLimitedEgressResponse,
  resolveTrustedProxyMode,
} from "../../functions/_shared/preauth-egress-guard.js";

const SECRET = "test-deployment-hmac-secret-2026";

describe("Pre-Auth Egress Guard: trusted ingress & HMAC IP hashing", () => {
  it("ignores spoofed X-Forwarded-For and CF-Connecting-IP when PORTALESS_TRUSTED_PROXY=none (default)", () => {
    const req = new Request("https://site.example/pages/foo", {
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "cf-connecting-ip": "5.6.7.8",
      },
    });
    expect(resolveTrustedProxyMode({})).toBe("none");
    expect(extractTrustedClientIp(req, {})).toBeNull();
    expect(extractTrustedClientIp(req, { PORTALESS_TRUSTED_PROXY: "none" })).toBeNull();
  });

  it("extracts CF-Connecting-IP only in cloudflare mode and ignores X-Forwarded-For", () => {
    const req = new Request("https://site.example/pages/foo", {
      headers: {
        "x-forwarded-for": "198.51.100.1",
        "cf-connecting-ip": "203.0.113.42",
      },
    });
    expect(extractTrustedClientIp(req, { PORTALESS_TRUSTED_PROXY: "cloudflare" })).toBe("203.0.113.42");
  });

  it("extracts X-Forwarded-For only in forwarded mode and ignores CF-Connecting-IP", () => {
    const req = new Request("https://site.example/pages/foo", {
      headers: {
        "x-forwarded-for": "198.51.100.77, 10.0.0.1",
        "cf-connecting-ip": "203.0.113.42",
      },
    });
    expect(extractTrustedClientIp(req, { PORTALESS_TRUSTED_PROXY: "forwarded" })).toBe("198.51.100.77");
  });

  it("uses runtime-verified x-portaless-client-ip on Node even in none mode", () => {
    const req = new Request("http://127.0.0.1:3000/pages/foo", {
      headers: {
        "x-forwarded-for": "9.9.9.9",
        "x-portaless-client-ip": "192.0.2.55",
      },
    });
    expect(extractTrustedClientIp(req, { __PORTALESS_RUNTIME: "node" })).toBe("192.0.2.55");
  });

  it("fails closed on invalid PORTALESS_TRUSTED_PROXY and missing HMAC secret in enforce mode", () => {
    expect(() => resolveTrustedProxyMode({ PORTALESS_TRUSTED_PROXY: "magic-proxy" })).toThrow(GatekeeperConfigError);
    expect(() => hashClientIp("203.0.113.10", {}, { mode: "enforce" })).toThrow(GatekeeperConfigError);
    expect(() =>
      hashClientIp("203.0.113.10", { PORTALESS_IP_HMAC_SECRET: "short" }, { mode: "enforce" })
    ).toThrow(GatekeeperConfigError);
  });

  it("never exposes raw IP in hashed tokens or budget storage keys", () => {
    const rawIp = "203.0.113.88";
    const ipHash = hashClientIp(rawIp, { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });
    expect(ipHash).toMatch(/^ip:[a-f0-9]{64}$/);
    expect(ipHash).not.toContain(rawIp);

    const guard = createPreAuthEgressGuard();
    guard.consumeBudget({ ipHash, origin: "https://agent.example" });
    const serializedKeys = JSON.stringify(guard.stats().budgetKeys);
    expect(serializedKeys).not.toContain(rawIp);
  });
});

describe("Pre-Auth Egress Guard: single-flight coalescing, budgets & bounded cache", () => {
  it("coalesces 25 concurrent requests (thundering herd) into exactly 1 underlying resolver call", async () => {
    const guard = createPreAuthEgressGuard();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const resolver = vi.fn(async () => {
      await gate;
      return { ok: true, did: "did:apw:agent.example" };
    });

    const ipHash = hashClientIp("198.51.100.1", { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });
    const promises = Array.from({ length: 25 }, () =>
      guard.resolveWithCoalescing("did:apw:agent.example", resolver, {
        ipHash,
        origin: "https://agent.example",
      })
    );
    release();
    const results = await Promise.all(promises);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(25);
    for (const r of results) {
      expect(r.allowed).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.value.did).toBe("did:apw:agent.example");
    }
    expect(results.filter((r) => r.coalesced).length).toBe(24);
  });

  it("enforces per-IP, per-origin, and global egress budgets (429 + Retry-After) without firing resolver", async () => {
    const guard = createPreAuthEgressGuard();
    const limits = { perIp: 2, perOrigin: 3, global: 4, windowMs: 60_000 };
    const resolver = vi.fn(async () => ({ ok: true }));

    const ipA = hashClientIp("198.51.100.10", { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });
    const ipB = hashClientIp("198.51.100.11", { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });
    const ipC = hashClientIp("198.51.100.12", { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });

    // Per-IP limit (2)
    expect((await guard.resolveWithCoalescing("k1", resolver, { ipHash: ipA, origin: "https://o1.example", limits })).allowed).toBe(true);
    expect((await guard.resolveWithCoalescing("k2", resolver, { ipHash: ipA, origin: "https://o1.example", limits })).allowed).toBe(true);
    const overIp = await guard.resolveWithCoalescing("k3", resolver, { ipHash: ipA, origin: "https://o1.example", limits });
    expect(overIp.allowed).toBe(false);
    expect(overIp.scope).toBe("ip");
    expect(overIp.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const res429 = rateLimitedEgressResponse(overIp.retryAfterSeconds!, overIp.scope!);
    expect(res429.status).toBe(429);
    expect(res429.headers.get("cache-control")).toBe("no-store");
    expect(Number(res429.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // Per-origin limit (3) reached by ipB on same origin o1
    expect((await guard.resolveWithCoalescing("k4", resolver, { ipHash: ipB, origin: "https://o1.example", limits })).allowed).toBe(true);
    const overOrigin = await guard.resolveWithCoalescing("k5", resolver, { ipHash: ipB, origin: "https://o1.example", limits });
    expect(overOrigin.allowed).toBe(false);
    expect(overOrigin.scope).toBe("origin");

    // Global limit (4) reached by ipC on a fresh origin o2
    expect((await guard.resolveWithCoalescing("k6", resolver, { ipHash: ipC, origin: "https://o2.example", limits })).allowed).toBe(true);
    const overGlobal = await guard.resolveWithCoalescing("k7", resolver, { ipHash: ipC, origin: "https://o2.example", limits });
    expect(overGlobal.allowed).toBe(false);
    expect(overGlobal.scope).toBe("global");

    // Resolver was called ONLY for the 4 allowed misses (never for blocked calls)
    expect(resolver).toHaveBeenCalledTimes(4);
  });

  it("evicts oldest cache entries strictly at maxEntries and caches short negative failures", async () => {
    const guard = createPreAuthEgressGuard({ maxEntries: 3, positiveTtlMs: 60_000, negativeTtlMs: 5_000 });
    const ipHash = hashClientIp("198.51.100.50", { PORTALESS_IP_HMAC_SECRET: SECRET }, { mode: "enforce" });
    const limits = { perIp: 100, perOrigin: 100, global: 100, windowMs: 60_000 };

    const failResolver = vi.fn(async () => ({ ok: false, reason: "nxdomain" }));
    const r1 = await guard.resolveWithCoalescing("neg-key", failResolver, { ipHash, origin: "https://neg.example", limits });
    const r2 = await guard.resolveWithCoalescing("neg-key", failResolver, { ipHash, origin: "https://neg.example", limits });
    expect(r1.ok).toBe(false);
    expect(r2.cached).toBe(true);
    expect(failResolver).toHaveBeenCalledTimes(1);

    // Fill past maxEntries=3 to verify strict LRU eviction
    await guard.resolveWithCoalescing("p1", async () => ({ ok: true }), { ipHash, origin: "https://a.example", limits });
    await guard.resolveWithCoalescing("p2", async () => ({ ok: true }), { ipHash, origin: "https://b.example", limits });
    await guard.resolveWithCoalescing("p3", async () => ({ ok: true }), { ipHash, origin: "https://c.example", limits });
    expect(guard.stats().cacheSize).toBe(3);

    // neg-key was evicted, so calling it again invokes failResolver a 2nd time
    await guard.resolveWithCoalescing("neg-key", failResolver, { ipHash, origin: "https://neg.example", limits });
    expect(failResolver).toHaveBeenCalledTimes(2);
    expect(guard.stats().cacheSize).toBe(3);
  });
});
