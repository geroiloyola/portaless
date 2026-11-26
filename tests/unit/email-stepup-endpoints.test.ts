// Contrato completo de step-up por email:
// - POST /admin/api/stepup/email/request (auth, CSRF, 503 sin backend, rate limit, cero fuga del OTP)
// - Consumo valido, rechazo por invalido/expirado/reuso/otro usuario en los 3 endpoints sensibles:
//   1. POST /admin/api/site-identity (rotacion did:apw)
//   2. POST /admin/settlement (activacion)
//   3. POST /admin/api/change-password (cambio de contrasena)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { clearCapturedEmails, getCapturedEmails } from "../../packages/auth/src/email-sender";

const stores = vi.hoisted(() => ({
  users: null as any,
  sessions: null as any,
  rateLimits: null as any,
  emailStepUp: null as any,
  siteIdentity: null as any,
  settlementActivation: null as any,
  permissions: null as any,
}));

vi.mock("@portaless/auth/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  const { InMemoryEmailStepUpStore } = await import("../../packages/auth/src/email-stepup-store");
  stores.users = new InMemoryUsersStore();
  stores.sessions = new InMemorySessionStore();
  stores.rateLimits = new InMemoryRateLimitStore();
  stores.emailStepUp = new InMemoryEmailStepUpStore();
  return {
    createUsersStore: async () => stores.users,
    createSessionStore: async () => stores.sessions,
    createRateLimitStore: async () => stores.rateLimits,
    createEmailStepUpStore: async () => stores.emailStepUp,
    createPasswordResetStore: async () => ({
      invalidateAllForUser: async () => {},
      create: async () => ({ token: "x" }),
      consume: async () => null,
    }),
  };
});

vi.mock("@portaless/auth/password-events", () => ({
  createPasswordEventStore: async () => ({
    record: async () => {},
    listForUser: async () => [],
  }),
  passwordEventContextFromRequest: () => ({ ip: "127.0.0.1" }),
}));

vi.mock("@portaless/dashboard/activity", () => ({
  emitActivity: async () => {},
}));

vi.mock("@portaless/trust-storage-adapters", async () => {
  const { InMemorySiteIdentityStore } = await import("@verared/apw/did-apw");
  const { InMemorySettlementActivationStore } = await import("@verared/trust-layer/billing");
  stores.siteIdentity = new InMemorySiteIdentityStore({
    encryptionKey: Buffer.alloc(32, 7).toString("base64"),
  });
  stores.settlementActivation = new InMemorySettlementActivationStore();
  return {
    createSiteIdentityStore: async () => stores.siteIdentity,
    createSettlementActivationStore: async () => stores.settlementActivation,
  };
});

vi.mock("@portaless/permissions/store-factory", () => {
  stores.permissions = { grant: async () => {}, revoke: async () => {}, list: async () => [] };
  return {
    createPermissionStore: async () => stores.permissions,
  };
});

import * as emailStepUpRequest from "../../functions/admin/api/stepup/email/request";
import * as siteIdentityEndpoint from "../../functions/admin/api/site-identity";
import * as settlementEndpoint from "../../functions/admin/settlement/index";
import * as changePasswordEndpoint from "../../functions/admin/api/change-password";

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function currentTotpCode(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const key = Buffer.from(
    normalized.split("").flatMap((ch) => {
      value = (value << 5) | alphabet.indexOf(ch);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        return [(value >> bits) & 0xff];
      }
      return [];
    })
  );
  const counter = Math.floor(now / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** 6).padStart(6, "0");
}

function extractOtpFromCapturedEmail(): string {
  const emails = getCapturedEmails();
  const last = emails[emails.length - 1];
  const match = last?.text.match(/\b(\d{8})\b/);
  if (!match) throw new Error("No 8-digit OTP found in captured email");
  return match[1];
}

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    PORTALESS_PUBLIC_URL: "https://site.example",
    PORTALESS_DEV_MODE: "1",
    PORTALESS_EMAIL_STEPUP_PER_IP: "10",
    PORTALESS_EMAIL_STEPUP_PER_USER: "5",
    ...extra,
  };
}

async function issueEmailOtp(username = "alice", ip = "198.51.100.1", envExtra: Record<string, unknown> = {}) {
  const res = await emailStepUpRequest.onRequestPost({
    request: new Request("https://site.example/admin/api/stepup/email/request", {
      method: "POST",
      headers: {
        origin: "https://site.example",
        "cf-connecting-ip": ip,
      },
    }),
    env: makeEnv(envExtra),
    data: { user: { username, role: "admin" } },
  } as any);
  const rawText = await res.text();
  return { res, rawText, body: JSON.parse(rawText) };
}

describe("Email step-up request & sensitive endpoint wiring", () => {
  beforeEach(async () => {
    clearCapturedEmails();
    const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
    const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
    const { InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
    const { InMemoryEmailStepUpStore } = await import("../../packages/auth/src/email-stepup-store");
    const { InMemorySiteIdentityStore } = await import("@verared/apw/did-apw");
    const { InMemorySettlementActivationStore } = await import("@verared/trust-layer/billing");
    stores.users = new InMemoryUsersStore();
    stores.sessions = new InMemorySessionStore();
    stores.rateLimits = new InMemoryRateLimitStore();
    stores.emailStepUp = new InMemoryEmailStepUpStore();
    stores.siteIdentity = new InMemorySiteIdentityStore({
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    stores.settlementActivation = new InMemorySettlementActivationStore();
    stores.permissions = { grant: async () => {}, revoke: async () => {}, list: async () => [] };

    await stores.users.createUser("alice", "Alice-Pass-1234!", "admin", "alice@site.example");
    await stores.users.setTotpSecret("alice", TOTP_SECRET);
    await stores.users.createUser("bob", "Bob-Pass-123456!", "admin", "bob@site.example");
    await stores.users.createUser("noemail", "NoEmail-Pass-12!", "admin");
  });

  it("POST /admin/api/stepup/email/request enforces auth, CSRF, explicit 503 when unconfigured, and never leaks OTP", async () => {
    // 1. Unauthenticated -> 401
    const unauth = await emailStepUpRequest.onRequestPost({
      request: new Request("https://site.example/admin/api/stepup/email/request", { method: "POST" }),
      env: makeEnv(),
      data: {},
    } as any);
    expect(unauth.status).toBe(401);

    // 2. Bad origin -> 403
    const badOrigin = await emailStepUpRequest.onRequestPost({
      request: new Request("https://site.example/admin/api/stepup/email/request", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(badOrigin.status).toBe(403);

    // 3. No email sender configured -> 503 email_backend_unavailable
    const noSender = await issueEmailOtp("alice", "198.51.100.2", { PORTALESS_DEV_MODE: undefined });
    expect(noSender.res.status).toBe(503);
    expect(noSender.body.error).toBe("email_backend_unavailable");
    expect(noSender.res.headers.get("cache-control")).toBe("no-store");

    // 4. User without email -> 400 user_has_no_email
    const noEmail = await issueEmailOtp("noemail", "198.51.100.3");
    expect(noEmail.res.status).toBe(400);
    expect(noEmail.body.error).toBe("user_has_no_email");

    // 5. Valid issue -> 200 { ok: true, token, expiresAt }, OTP NOT in response
    const ok = await issueEmailOtp("alice", "198.51.100.4");
    expect(ok.res.status).toBe(200);
    expect(ok.res.headers.get("cache-control")).toBe("no-store");
    expect(ok.body.ok).toBe(true);
    expect(typeof ok.body.token).toBe("string");
    expect(ok.body.token.length).toBeGreaterThan(20);
    const code = extractOtpFromCapturedEmail();
    expect(ok.rawText).not.toContain(code);
  });

  it("enforces per-user and per-IP rate limits on POST /admin/api/stepup/email/request", async () => {
    const r1 = await issueEmailOtp("alice", "198.51.100.20", { PORTALESS_EMAIL_STEPUP_PER_USER: "2" });
    expect(r1.res.status).toBe(200);
    const r2 = await issueEmailOtp("alice", "198.51.100.21", { PORTALESS_EMAIL_STEPUP_PER_USER: "2" });
    expect(r2.res.status).toBe(200);
    const r3 = await issueEmailOtp("alice", "198.51.100.22", { PORTALESS_EMAIL_STEPUP_PER_USER: "2" });
    expect(r3.res.status).toBe(429);
    expect(Number(r3.res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // Per-IP limit across different users
    const ip1 = await issueEmailOtp("bob", "198.51.100.30", { PORTALESS_EMAIL_STEPUP_PER_IP: "1" });
    expect(ip1.res.status).toBe(200);
    const ip2 = await issueEmailOtp("noemail", "198.51.100.30", { PORTALESS_EMAIL_STEPUP_PER_IP: "1" });
    expect(ip2.res.status).toBe(429);
  });

  it("rotates did:apw via email step-up, rejects invalid/reused/cross-user codes", async () => {
    // Seed initial site identity
    const createRes = await siteIdentityEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "site.example" }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(createRes.status).toBe(201);
    expect(createRes.headers.get("cache-control")).toBe("no-store");

    const issued = await issueEmailOtp("alice");
    const code = extractOtpFromCapturedEmail();

    // Cross-user token (issued for alice, submitted by bob) -> 401
    const crossUser = await siteIdentityEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotate: true, confirm: "ROTAR", emailToken: issued.body.token, emailCode: code }),
      }),
      env: makeEnv(),
      data: { user: { username: "bob", role: "admin" } },
    } as any);
    expect(crossUser.status).toBe(401);

    // Wrong code -> 401 invalid_email_code
    const wrongCode = await siteIdentityEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotate: true, confirm: "ROTAR", emailToken: issued.body.token, emailCode: "00000000" }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(wrongCode.status).toBe(401);
    expect((await wrongCode.json()).reason).toBe("invalid_email_code");

    // Valid email step-up -> 200 rotation succeeds
    const rotated = await siteIdentityEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotate: true, confirm: "ROTAR", emailToken: issued.body.token, emailCode: code }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get("cache-control")).toBe("no-store");

    // Strict single-use: replaying the same token+code fails with 401 email_code_expired
    const replay = await siteIdentityEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotate: true, confirm: "ROTAR", emailToken: issued.body.token, emailCode: code }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(replay.status).toBe(401);
    expect((await replay.json()).reason).toBe("email_code_expired");
  });

  it("verifies email step-up on POST /admin/settlement activate (passes step-up, rejects invalid/reused)", async () => {
    const issued = await issueEmailOtp("alice");
    const code = extractOtpFromCapturedEmail();

    // Invalid code -> 401 step_up_failed
    const bad = await settlementEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          providerId: "unknown-provider",
          credentials: { apiToken: "tok" },
          confirmOriginLocked: true,
          emailToken: issued.body.token,
          emailCode: "99999999",
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(bad.status).toBe(401);
    expect((await bad.json()).reason).toBe("invalid_email_code");

    // Valid code -> passes step-up (reaches provider check -> 404 unknown provider, NOT 401 step_up_failed)
    const passed = await settlementEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          providerId: "unknown-provider",
          credentials: { apiToken: "tok" },
          confirmOriginLocked: true,
          emailToken: issued.body.token,
          emailCode: code,
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(passed.status).not.toBe(401);
    expect(passed.headers.get("cache-control")).toBe("no-store");

    // Reuse -> 401 step_up_failed (email_code_expired)
    const reuse = await settlementEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          providerId: "unknown-provider",
          credentials: { apiToken: "tok" },
          confirmOriginLocked: true,
          emailToken: issued.body.token,
          emailCode: code,
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(reuse.status).toBe(401);
    expect((await reuse.json()).reason).toBe("email_code_expired");
  });

  it("supports email step-up and preserves password+TOTP on POST /admin/api/change-password", async () => {
    const issued = await issueEmailOtp("alice");
    const code = extractOtpFromCapturedEmail();

    // Wrong currentPassword fails BEFORE consuming OTP
    const wrongPass = await changePasswordEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "Wrong-Password-1!",
          newPassword: "New-Alice-Pass-2026!",
          emailToken: issued.body.token,
          emailCode: code,
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(wrongPass.status).toBe(400);
    expect((await wrongPass.json()).error).toBe("invalid_password");

    // Correct currentPassword + same unconsumed OTP -> 200
    const okEmail = await changePasswordEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "Alice-Pass-1234!",
          newPassword: "New-Alice-Pass-2026!",
          emailToken: issued.body.token,
          emailCode: code,
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(okEmail.status).toBe(200);
    expect(okEmail.headers.get("cache-control")).toBe("no-store");

    // Reusing the consumed OTP fails with email_code_expired
    const replay = await changePasswordEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "New-Alice-Pass-2026!",
          newPassword: "Another-Pass-2026!",
          emailToken: issued.body.token,
          emailCode: code,
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("email_code_expired");

    // Classic password + TOTP still works
    const okTotp = await changePasswordEndpoint.onRequestPost({
      request: new Request("https://site.example/admin/api/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "New-Alice-Pass-2026!",
          newPassword: "Final-Alice-Pass-26!",
          totpCode: currentTotpCode(TOTP_SECRET),
        }),
      }),
      env: makeEnv(),
      data: { user: { username: "alice", role: "admin" } },
    } as any);
    expect(okTotp.status).toBe(200);
  });
});
