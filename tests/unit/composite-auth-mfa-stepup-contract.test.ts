// E-08 Flujo compuesto 1 (determinista, sin red externa):
// login -> MFA -> Set-Cookie -> admin/_middleware -> step-up por email ->
// mutacion sensible (rotar did:apw) + rechazo de reuso -> logout -> sesion invalidada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { clearCapturedEmails, getCapturedEmails } from "../../packages/auth/src/email-sender";

const stores = vi.hoisted(() => ({
  users: null as any,
  sessions: null as any,
  mfaChallenges: null as any,
  rateLimits: null as any,
  emailStepUp: null as any,
  siteIdentity: null as any,
}));

vi.mock("@portaless/auth/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { InMemoryMfaChallengeStore, InMemoryRateLimitStore } = await import(
    "../../packages/auth/src/ephemeral-auth-store"
  );
  const { InMemoryEmailStepUpStore } = await import("../../packages/auth/src/email-stepup-store");
  stores.users = new InMemoryUsersStore();
  stores.sessions = new InMemorySessionStore();
  stores.mfaChallenges = new InMemoryMfaChallengeStore();
  stores.rateLimits = new InMemoryRateLimitStore();
  stores.emailStepUp = new InMemoryEmailStepUpStore();
  return {
    createUsersStore: async () => stores.users,
    createSessionStore: async () => stores.sessions,
    createMfaChallengeStore: async () => stores.mfaChallenges,
    createRateLimitStore: async () => stores.rateLimits,
    createEmailStepUpStore: async () => stores.emailStepUp,
    createPasswordResetStore: async () => ({
      invalidateAllForUser: async () => {},
      create: async () => ({ token: "x" }),
      consume: async () => null,
    }),
  };
});

vi.mock("@portaless/trust-storage-adapters", async () => {
  const { InMemorySiteIdentityStore } = await import("@verared/apw/did-apw");
  stores.siteIdentity = new InMemorySiteIdentityStore({
    encryptionKey: Buffer.alloc(32, 9).toString("base64"),
  });
  return {
    createSiteIdentityStore: async () => stores.siteIdentity,
  };
});

import * as adminMiddleware from "../../functions/admin/_middleware";
import * as loginEndpoint from "../../functions/admin/login";
import * as loginMfaEndpoint from "../../functions/admin/login-mfa";
import * as logoutEndpoint from "../../functions/admin/logout";
import * as emailStepUpEndpoint from "../../functions/admin/api/stepup/email/request";
import * as siteIdentityEndpoint from "../../functions/admin/api/site-identity";

const ORIGIN = "https://site.example";
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
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** 6).padStart(6, "0");
}

function makeEnv() {
  return {
    PORTALESS_PUBLIC_URL: ORIGIN,
    PORTALESS_DEV_MODE: "1",
  };
}

/** Runs admin/_middleware.js and forwards context.data into the target handler. */
async function callProtected(
  request: Request,
  handler: (ctx: any) => Promise<Response>,
  env = makeEnv()
): Promise<Response> {
  const ctx: any = { request, env, data: {}, params: {} };
  ctx.next = () => handler(ctx);
  return adminMiddleware.onRequest(ctx);
}

describe("E-08 composite contract: login -> MFA -> cookie -> protected -> step-up -> logout", () => {
  beforeEach(async () => {
    clearCapturedEmails();
    const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
    const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
    const { InMemoryMfaChallengeStore, InMemoryRateLimitStore } = await import(
      "../../packages/auth/src/ephemeral-auth-store"
    );
    const { InMemoryEmailStepUpStore } = await import("../../packages/auth/src/email-stepup-store");
    const { InMemorySiteIdentityStore } = await import("@verared/apw/did-apw");

    stores.users = new InMemoryUsersStore();
    stores.sessions = new InMemorySessionStore();
    stores.mfaChallenges = new InMemoryMfaChallengeStore();
    stores.rateLimits = new InMemoryRateLimitStore();
    stores.emailStepUp = new InMemoryEmailStepUpStore();
    stores.siteIdentity = new InMemorySiteIdentityStore({
      encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    });

    await stores.users.createUser("alice", "Alice-Strong-Pass-1!", "admin", "alice@site.example");
    await stores.users.setTotpSecret("alice", TOTP_SECRET);
  });

  it("completes the full auth lifecycle end-to-end and invalidates the session on logout", async () => {
    const env = makeEnv();

    // 1. POST /admin/login with password on TOTP user -> 302 /admin/login-mfa?challenge=...
    const loginRes = await loginEndpoint.onRequestPost({
      request: new Request(`${ORIGIN}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          "cf-connecting-ip": "198.51.100.5",
        },
        body: new URLSearchParams({ username: "alice", password: "Alice-Strong-Pass-1!" }).toString(),
      }),
      env,
      data: {},
      params: {},
    } as any);
    expect(loginRes.status).toBe(302);
    const challengeToken = new URL(loginRes.headers.get("location")!).searchParams.get("challenge")!;
    expect(challengeToken).toBeTruthy();

    // 2. POST /admin/login-mfa with real TOTP code -> 200 + Set-Cookie: portaless_session=...
    const mfaRes = await loginMfaEndpoint.onRequestPost({
      request: new Request(`${ORIGIN}/admin/login-mfa`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "cf-connecting-ip": "198.51.100.5",
        },
        body: JSON.stringify({ challengeToken, code: currentTotpCode(TOTP_SECRET) }),
      }),
      env,
      data: {},
      params: {},
    } as any);
    expect(mfaRes.status).toBe(200);
    const setCookie = mfaRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("portaless_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    const sessionPair = setCookie.split(";")[0];

    // 3. Create initial site identity through admin/_middleware using the real Set-Cookie
    const createIdRes = await callProtected(
      new Request(`${ORIGIN}/admin/api/site-identity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          Cookie: sessionPair,
        },
        body: JSON.stringify({ domain: "site.example" }),
      }),
      siteIdentityEndpoint.onRequestPost,
      env
    );
    expect(createIdRes.status).toBe(201);

    // 4. Request email step-up OTP through admin/_middleware
    const stepUpReqRes = await callProtected(
      new Request(`${ORIGIN}/admin/api/stepup/email/request`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          Cookie: sessionPair,
          "cf-connecting-ip": "198.51.100.5",
        },
      }),
      emailStepUpEndpoint.onRequestPost,
      env
    );
    expect(stepUpReqRes.status).toBe(200);
    const stepUpData = await stepUpReqRes.json();
    const otpCode = getCapturedEmails().at(-1)!.text.match(/\b(\d{8})\b/)![1];

    // 5. Execute sensitive rotation using session cookie + email step-up OTP -> 200
    const rotateRes = await callProtected(
      new Request(`${ORIGIN}/admin/api/site-identity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          Cookie: sessionPair,
        },
        body: JSON.stringify({
          rotate: true,
          confirm: "ROTAR",
          emailToken: stepUpData.token,
          emailCode: otpCode,
        }),
      }),
      siteIdentityEndpoint.onRequestPost,
      env
    );
    expect(rotateRes.status).toBe(200);

    // 6. Replaying the same single-use OTP fails -> 401 email_code_expired
    const replayRes = await callProtected(
      new Request(`${ORIGIN}/admin/api/site-identity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          Cookie: sessionPair,
        },
        body: JSON.stringify({
          rotate: true,
          confirm: "ROTAR",
          emailToken: stepUpData.token,
          emailCode: otpCode,
        }),
      }),
      siteIdentityEndpoint.onRequestPost,
      env
    );
    expect(replayRes.status).toBe(401);
    expect((await replayRes.json()).reason).toBe("email_code_expired");

    // 7. POST /admin/logout destroys session and emits Max-Age=0 clear cookie
    const logoutRes = await callProtected(
      new Request(`${ORIGIN}/admin/logout`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          Cookie: sessionPair,
        },
      }),
      logoutEndpoint.onRequestPost,
      env
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("cache-control")).toBe("no-store");
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");

    // 8. Reusing the old session cookie after logout is rejected by admin/_middleware -> 302 login
    const afterLogoutRes = await callProtected(
      new Request(`${ORIGIN}/admin/api/site-identity`, {
        method: "GET",
        headers: { Cookie: sessionPair },
      }),
      siteIdentityEndpoint.onRequestGet,
      env
    );
    expect(afterLogoutRes.status).toBe(302);
    expect(afterLogoutRes.headers.get("location")).toContain("/admin/login?error=1");
  });
});
