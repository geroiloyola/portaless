// Composite contract suite for the Local Trust Protocol Gatekeeper runtime:
//   - modes: off (default), shadow, enforce, and unknown (fail-closed 503)
//   - public vs governed routes (B3)
//   - valid Ed25519 signature + clean / denied reputation
//   - invalid Ed25519 signature -> 401 without calling identity or reputation
//   - pre-auth egress budget exhaustion -> 429 + Retry-After before resolver
//   - /healthz exact exemption across all modes
//   - Cloudflare Pages (functions/_middleware.js) + Node self-host (server/node-runtime.mjs) parity
// 100% deterministic, zero external network.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { onRequest, __resetMigrationGateForTests } from "../../functions/_middleware.js";
import { createPreAuthEgressGuard } from "../../functions/_shared/preauth-egress-guard.js";
import {
  resolveGatekeeperMode,
  createVeraTrustHostAdapter,
} from "../../functions/_shared/gatekeeper-runtime.js";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import {
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
} from "@verared/trust-layer";
import { __resetNonceStoreFactoryForTests } from "@portaless/trust-storage-adapters";

const OPERATOR_ORIGIN = "https://agent-operator.example.com";
const KEY_ID = "gk-contract-key-1";
const DEFAULT_COMPONENTS = '"@method" "@authority" "@path" "signature-agent"';
const TEST_HMAC_SECRET = "test-gatekeeper-hmac-secret-at-least-32-bytes";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function generateEd25519Pair() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyX: bytesToBase64Url(rawPub) };
}

async function buildSignedRequest(
  privateKey: CryptoKey,
  opts: { nonce: string; url?: string; extraHeaders?: Record<string, string>; tamper?: boolean }
): Promise<Request> {
  const url = opts.url ?? "https://site.example/pages/hello";
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;
  const agentHeader = `"${OPERATOR_ORIGIN}"`;
  const paramsLine =
    `(${DEFAULT_COMPONENTS})` +
    `;created=${created};expires=${expires}` +
    `;keyid="${KEY_ID}";alg="ed25519"` +
    `;nonce="${opts.nonce}"` +
    `;tag="web-bot-auth"`;
  const u = new URL(url);
  const signatureBase = `"@method": GET\n"@authority": ${u.host}\n"@path": ${u.pathname}\n"signature-agent": ${agentHeader}\n"@signature-params": ${paramsLine}`;
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase))
  );
  if (opts.tamper) sigBytes[0] ^= 0xff;
  return new Request(url, {
    method: "GET",
    headers: {
      "Signature-Agent": agentHeader,
      "Signature-Input": `sig1=${paramsLine}`,
      Signature: `sig1=:${bytesToBase64(sigBytes)}:`,
      ...(opts.extraHeaders ?? {}),
    },
  });
}

function assetsWithAccess(access: "allow" | "block" | "charge") {
  const manifest = {
    version: "0.1",
    site: "site.example",
    policies: {
      search: { access: "allow", price_usd: 0 },
      ai_input: { access, price_usd: access === "charge" ? 0.01 : 0, unit: "request" },
      ai_train: { access: "block" },
    },
    free_for: [],
    contact: "",
  };
  return {
    fetch: async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  };
}

function makeDirectoryFetcher(publicKeyX: string) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }] }),
      { status: 200, headers: { "content-type": "application/http-message-signatures-directory+json" } }
    )
  );
}

function makeContext(request: Request, env: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const next = vi.fn(async () => new Response("OK-NEXT", { status: 200 }));
  return { context: { request, env, data, next, params: {} } as any, next, data };
}

describe("Gatekeeper runtime contract (off | shadow | enforce)", () => {
  beforeEach(() => {
    __resetMigrationGateForTests();
    __resetDirectoryCacheForTests();
    __resetNonceStoreForTests();
    __resetNonceStoreFactoryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves mode default='off', accepts off|shadow|enforce, and fails closed on unknown mode (503)", async () => {
    expect(resolveGatekeeperMode({})).toBe("off");
    expect(resolveGatekeeperMode({ PORTALESS_GATEKEEPER_MODE: "shadow" })).toBe("shadow");
    expect(resolveGatekeeperMode({ PORTALESS_GATEKEEPER_MODE: "ENFORCE" })).toBe("enforce");
    expect(() => resolveGatekeeperMode({ PORTALESS_GATEKEEPER_MODE: "permissive" })).toThrow(/invalid_gatekeeper_mode|invalido/i);

    const { context, next } = makeContext(new Request("https://site.example/pages/hello"), {
      ENABLE_TRUST_LAYER: "true",
      PORTALESS_GATEKEEPER_MODE: "unknown-mode",
      PORTALESS_GATEKEEPER_LOG: "false",
    });
    const res = await onRequest(context);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "gatekeeper_misconfigured", reason: "invalid_gatekeeper_mode" });
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed (503) in enforce mode when PORTALESS_IP_HMAC_SECRET is missing", async () => {
    const { context, next } = makeContext(new Request("https://site.example/pages/hello"), {
      ENABLE_TRUST_LAYER: "true",
      PORTALESS_GATEKEEPER_MODE: "enforce",
      PORTALESS_GATEKEEPER_LOG: "false",
    });
    const res = await onRequest(context);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "gatekeeper_misconfigured", reason: "missing_ip_hmac_secret" });
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps /healthz strictly exempt across off, shadow, enforce, and invalid modes", async () => {
    for (const mode of ["off", "shadow", "enforce", "invalid-mode"]) {
      const req = new Request("https://site.example/healthz", {
        headers: { "user-agent": "UptimeRobot/2.0" },
      });
      const { context, next } = makeContext(req, {
        ENABLE_TRUST_LAYER: "true",
        PORTALESS_GATEKEEPER_MODE: mode,
        PORTALESS_GOVERNED_PATHS: "/healthz,/api/private",
      });
      const res = await onRequest(context);
      expect(res.status, `mode=${mode}`).toBe(200);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it("enforces B3 public vs governed routes consistently in off, shadow, and enforce", async () => {
    for (const mode of ["off", "shadow", "enforce"] as const) {
      const telemetry: Array<Record<string, unknown>> = [];
      const identityResolver = vi.fn();
      const reputationEvaluator = vi.fn();
      const baseEnv = {
        ENABLE_TRUST_LAYER: "true",
        PORTALESS_GATEKEEPER_MODE: mode,
        PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
        PORTALESS_GOVERNED_PATHS: "/api/governed",
        PORTALESS_PUBLIC_URL: "https://site.example",
        PORTALESS_GATEKEEPER_LOG: "false",
        ASSETS: assetsWithAccess("allow"),
        __PORTALESS_PREAUTH_GUARD: createPreAuthEgressGuard(),
        __PORTALESS_GATEKEEPER_SINK: (e: Record<string, unknown>) => telemetry.push(e),
        __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: identityResolver,
        __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: reputationEvaluator,
      };

      // Public route + ai_input=allow + unsigned automated UA => anonymous 200
      const pub = makeContext(
        new Request("https://site.example/pages/public", { headers: { "user-agent": "GPTBot/1.0" } }),
        baseEnv
      );
      const pubRes = await onRequest(pub.context);
      expect(pubRes.status, `public mode=${mode}`).toBe(200);
      expect(pub.data.webBotAuth).toEqual({ verified: false, anonymous: true });

      // Governed route + ai_input=allow + unsigned request => 403
      const gov = makeContext(
        new Request("https://site.example/api/governed/items", { headers: { "user-agent": "Mozilla/5.0" } }),
        baseEnv
      );
      const govRes = await onRequest(gov.context);
      expect(govRes.status, `governed mode=${mode}`).toBe(403);
      expect(await govRes.json()).toMatchObject({ error: "unsigned_automated_request" });

      // Neither unsigned case ever invokes outbound identity/reputation resolvers
      expect(identityResolver).not.toHaveBeenCalled();
      expect(reputationEvaluator).not.toHaveBeenCalled();
    }
  });

  it("valid signature + clean reputation allows and attributes in enforce mode without leaking raw IP", async () => {
    const { privateKey, publicKeyX } = await generateEd25519Pair();
    const directoryFetcher = makeDirectoryFetcher(publicKeyX);
    vi.stubGlobal("fetch", directoryFetcher);
    const telemetry: Array<Record<string, unknown>> = [];
    const identityResolver = vi.fn(async () => ({ verified: true, subject: "did:apw:agent-operator.example.com" }));
    const reputationEvaluator = vi.fn(async () => ({ decision: "allow", score: 85, level: "high" }));

    const req = await buildSignedRequest(privateKey, {
      nonce: "gk-valid-clean-1",
      extraHeaders: { "cf-connecting-ip": "203.0.113.77" },
    });
    const { context, next, data } = makeContext(req, {
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
      PORTALESS_GATEKEEPER_MODE: "enforce",
      PORTALESS_TRUSTED_PROXY: "cloudflare",
      PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_GATEKEEPER_LOG: "false",
      ASSETS: assetsWithAccess("allow"),
      __PORTALESS_PREAUTH_GUARD: createPreAuthEgressGuard(),
      __PORTALESS_GATEKEEPER_SINK: (e: Record<string, unknown>) => telemetry.push(e),
      __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: identityResolver,
      __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: reputationEvaluator,
    });

    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect((data.webBotAuth as any)?.verified).toBe(true);
    expect((data.gatekeeper as any)?.decision).toBe("allow");
    expect(identityResolver).toHaveBeenCalledTimes(1);
    expect(reputationEvaluator).toHaveBeenCalledTimes(1);
    expect(telemetry.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(telemetry)).not.toContain("203.0.113.77");
    expect(JSON.stringify(telemetry)).not.toContain(TEST_HMAC_SECRET);
  });

  it("denied reputation logs wouldBlock in shadow (200) and blocks with 403 in enforce", async () => {
    const { privateKey, publicKeyX } = await generateEd25519Pair();
    const directoryFetcher = makeDirectoryFetcher(publicKeyX);
    vi.stubGlobal("fetch", directoryFetcher);

    // shadow: must NOT block
    const shadowEvents: Array<Record<string, unknown>> = [];
    const shadowReq = await buildSignedRequest(privateKey, { nonce: "gk-deny-shadow-1" });
    const shadowCtx = makeContext(shadowReq, {
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
      PORTALESS_GATEKEEPER_MODE: "shadow",
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_GATEKEEPER_LOG: "false",
      ASSETS: assetsWithAccess("allow"),
      __PORTALESS_PREAUTH_GUARD: createPreAuthEgressGuard(),
      __PORTALESS_GATEKEEPER_SINK: (e: Record<string, unknown>) => shadowEvents.push(e),
      __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: async () => ({ verified: true }),
      __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: async () => ({ decision: "deny", score: 10, level: "low", reason: "low_reputation" }),
    });
    const shadowRes = await onRequest(shadowCtx.context);
    expect(shadowRes.status).toBe(200);
    expect(shadowCtx.next).toHaveBeenCalledTimes(1);
    expect(shadowEvents.some((e) => e.wouldBlock === true && e.enforcedAction === "allow")).toBe(true);

    // enforce: must block with 403 gatekeeper_denied + no-store
    const enforceReq = await buildSignedRequest(privateKey, { nonce: "gk-deny-enforce-1" });
    const enforceCtx = makeContext(enforceReq, {
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
      PORTALESS_GATEKEEPER_MODE: "enforce",
      PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_GATEKEEPER_LOG: "false",
      ASSETS: assetsWithAccess("allow"),
      __PORTALESS_PREAUTH_GUARD: createPreAuthEgressGuard(),
      __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: async () => ({ verified: true }),
      __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: async () => ({ decision: "deny", score: 10, level: "low", reason: "low_reputation" }),
    });
    const enforceRes = await onRequest(enforceCtx.context);
    expect(enforceRes.status).toBe(403);
    expect(enforceRes.headers.get("cache-control")).toBe("no-store");
    expect(await enforceRes.json()).toMatchObject({ error: "gatekeeper_denied", reason: "low_reputation" });
    expect(enforceCtx.next).not.toHaveBeenCalled();
  });

  it("invalid signature returns 401 immediately without invoking identity resolver or reputation evaluator", async () => {
    const { privateKey, publicKeyX } = await generateEd25519Pair();
    const directoryFetcher = makeDirectoryFetcher(publicKeyX);
    vi.stubGlobal("fetch", directoryFetcher);
    const identityResolver = vi.fn();
    const reputationEvaluator = vi.fn();

    const tamperedReq = await buildSignedRequest(privateKey, { nonce: "gk-tampered-1", tamper: true });
    const { context, next } = makeContext(tamperedReq, {
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
      PORTALESS_GATEKEEPER_MODE: "enforce",
      PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_GATEKEEPER_LOG: "false",
      ASSETS: assetsWithAccess("allow"),
      __PORTALESS_PREAUTH_GUARD: createPreAuthEgressGuard(),
      __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: identityResolver,
      __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: reputationEvaluator,
    });

    const res = await onRequest(context);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(next).not.toHaveBeenCalled();
    expect(identityResolver).not.toHaveBeenCalled();
    expect(reputationEvaluator).not.toHaveBeenCalled();
  });

  it("exhausting pre-auth egress budget in enforce returns 429 + Retry-After BEFORE directory/identity/reputation calls", async () => {
    const { privateKey, publicKeyX } = await generateEd25519Pair();
    const directoryFetcher = makeDirectoryFetcher(publicKeyX);
    vi.stubGlobal("fetch", directoryFetcher);
    const identityResolver = vi.fn(async () => ({ verified: true }));
    const reputationEvaluator = vi.fn(async () => ({ decision: "allow", score: 80, level: "high" }));
    const guard = createPreAuthEgressGuard();

    const env = {
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
      PORTALESS_GATEKEEPER_MODE: "enforce",
      PORTALESS_TRUSTED_PROXY: "cloudflare",
      PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
      PORTALESS_EGRESS_BUDGET_PER_IP: "1",
      PORTALESS_EGRESS_BUDGET_PER_ORIGIN: "10",
      PORTALESS_EGRESS_BUDGET_GLOBAL: "10",
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_GATEKEEPER_LOG: "false",
      ASSETS: assetsWithAccess("allow"),
      __PORTALESS_PREAUTH_GUARD: guard,
      __PORTALESS_GATEKEEPER_IDENTITY_RESOLVER: identityResolver,
      __PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR: reputationEvaluator,
    };

    // Request 1 consumes the 1-unit per-IP budget
    const req1 = await buildSignedRequest(privateKey, {
      nonce: "gk-budget-1",
      extraHeaders: { "cf-connecting-ip": "198.51.100.55" },
    });
    const res1 = await onRequest(makeContext(req1, env).context);
    expect(res1.status).toBe(200);
    expect(directoryFetcher).toHaveBeenCalledTimes(1);
    expect(identityResolver).toHaveBeenCalledTimes(1);

    // Request 2 from the same IP is rejected with 429 BEFORE directory/identity/reputation
    const req2 = await buildSignedRequest(privateKey, {
      nonce: "gk-budget-2",
      extraHeaders: { "cf-connecting-ip": "198.51.100.55" },
    });
    const res2 = await onRequest(makeContext(req2, env).context);
    expect(res2.status).toBe(429);
    expect(res2.headers.get("cache-control")).toBe("no-store");
    expect(Number(res2.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await res2.json()).toMatchObject({ error: "egress_budget_exceeded", scope: "ip" });
    expect(directoryFetcher).toHaveBeenCalledTimes(1);
    expect(identityResolver).toHaveBeenCalledTimes(1);
    expect(reputationEvaluator).toHaveBeenCalledTimes(1);
  });

  it("exposes an isolated @verared/* host adapter boundary for the future v0.1.0-rc.1 repin", () => {
    const adapter = createVeraTrustHostAdapter({});
    expect(adapter.packageBoundary.identityPackage).toBe("@verared/local-trust");
    expect(adapter.packageBoundary.reputationPackage).toBe("@verared/reputation");
    expect(adapter.packageBoundary.limits).toBeTruthy();
  });

  it("maintains full Gatekeeper + /healthz parity on booted Node self-host server (server/node-runtime.mjs)", async () => {
    const staticDir = mkdtempSync(join(tmpdir(), "portaless-gk-selfhost-"));
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><html><body>home</body></html>");

    const server = await createSelfHostServer({
      staticDir,
      env: {
        ENABLE_TRUST_LAYER: "true",
        PORTALESS_GATEKEEPER_MODE: "enforce",
        PORTALESS_IP_HMAC_SECRET: TEST_HMAC_SECRET,
        PORTALESS_GOVERNED_PATHS: "/api/governed",
        PORTALESS_PUBLIC_URL: "http://127.0.0.1",
        PORTALESS_GATEKEEPER_LOG: "false",
      },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await fetch(`${base}/healthz`, { headers: { "user-agent": "UptimeRobot/2.0" } });
      expect(healthRes.status).toBe(200);
      expect(healthRes.headers.get("cache-control")).toBe("no-store");
      expect(await healthRes.json()).toMatchObject({ ok: true, runtime: "portaless-node" });

      const govRes = await fetch(`${base}/api/governed/secret`);
      expect(govRes.status).toBe(403);
      expect(govRes.headers.get("cache-control")).toBe("no-store");
      expect(await govRes.json()).toMatchObject({ error: "unsigned_automated_request" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(staticDir, { recursive: true, force: true });
    }
  });
});
