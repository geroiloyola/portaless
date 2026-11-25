// N-03: Presupuesto dedicado por IP para emision y verificacion de desafios MFA.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const state = vi.hoisted(() => ({
  users: null as any,
  sessions: null as any,
  mfaChallenges: null as any,
  rateLimits: null as any,
}));

vi.mock("@portaless/auth/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { InMemoryMfaChallengeStore, InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  state.users = new InMemoryUsersStore();
  state.sessions = new InMemorySessionStore();
  state.mfaChallenges = new InMemoryMfaChallengeStore();
  state.rateLimits = new InMemoryRateLimitStore();
  return {
    createUsersStore: async () => state.users,
    createSessionStore: async () => state.sessions,
    createMfaChallengeStore: async () => state.mfaChallenges,
    createRateLimitStore: async () => state.rateLimits,
    createPasswordResetStore: async () => ({
      invalidateAllForUser: async () => {},
      create: async () => ({ token: "x" }),
      consume: async () => null,
    }),
  };
});

import * as login from "../../functions/admin/login";
import * as loginMfa from "../../functions/admin/login-mfa";

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

function loginCtx(ip: string, envExtra: Record<string, unknown> = {}) {
  const url = "https://site.example/admin/login";
  const body = new URLSearchParams({ username: "mfa-admin", password: "Valid-Password-123!" }).toString();
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://site.example",
      "cf-connecting-ip": ip,
    },
    body,
  });
  return {
    request,
    env: {
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_MFA_ISSUANCE_PER_IP: "2",
      PORTALESS_MFA_ATTEMPTS_PER_IP: "2",
      ...envExtra,
    },
    data: {},
    params: {},
    next: async () => new Response("next"),
  } as any;
}

function mfaVerifyCtx(ip: string, challengeToken: string, code: string) {
  const request = new Request("https://site.example/admin/login-mfa", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://site.example",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ challengeToken, code }),
  });
  return {
    request,
    env: {
      PORTALESS_PUBLIC_URL: "https://site.example",
      PORTALESS_MFA_ATTEMPTS_PER_IP: "2",
    },
    data: {},
    params: {},
    next: async () => new Response("next"),
  } as any;
}

describe("N-03: dedicated per-IP MFA challenge issuance & verification budget", () => {
  beforeEach(async () => {
    const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
    const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
    const { InMemoryMfaChallengeStore, InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
    state.users = new InMemoryUsersStore();
    state.sessions = new InMemorySessionStore();
    state.mfaChallenges = new InMemoryMfaChallengeStore();
    state.rateLimits = new InMemoryRateLimitStore();
    await state.users.createUser("mfa-admin", "Valid-Password-123!", "admin");
    await state.users.setTotpSecret("mfa-admin", TOTP_SECRET);
  });

  it("allows MFA challenge issuance within limit, returns 429 + Retry-After when exceeded, and isolates IPs", async () => {
    const r1 = await login.onRequestPost(loginCtx("198.51.100.10"));
    expect(r1.status).toBe(302);
    expect(r1.headers.get("location")).toContain("/admin/login-mfa?challenge=");
    expect(r1.headers.get("cache-control")).toBe("no-store");

    const r2 = await login.onRequestPost(loginCtx("198.51.100.10"));
    expect(r2.status).toBe(302);
    expect(r2.headers.get("location")).toContain("/admin/login-mfa?challenge=");

    // 3rd issuance from the same IP exceeds PORTALESS_MFA_ISSUANCE_PER_IP=2
    const r3 = await login.onRequestPost(loginCtx("198.51.100.10"));
    expect(r3.status).toBe(429);
    expect(r3.headers.get("cache-control")).toBe("no-store");
    expect(Number(r3.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await r3.json()).toEqual({ success: false, error: "rate_limited" });

    // A different IP is unaffected
    const rOtherIp = await login.onRequestPost(loginCtx("198.51.100.99"));
    expect(rOtherIp.status).toBe(302);
    expect(rOtherIp.headers.get("location")).toContain("/admin/login-mfa?challenge=");
  });

  it("enforces per-IP MFA verification budget on POST /admin/login-mfa and isolates IPs", async () => {
    const issued = await login.onRequestPost(loginCtx("203.0.113.1"));
    const challengeToken = new URL(issued.headers.get("location")!).searchParams.get("challenge")!;

    const a1 = await loginMfa.onRequestPost(mfaVerifyCtx("203.0.113.1", challengeToken, "000000"));
    expect(a1.status).toBe(401);
    expect(a1.headers.get("cache-control")).toBe("no-store");

    const a2 = await loginMfa.onRequestPost(mfaVerifyCtx("203.0.113.1", challengeToken, "000000"));
    expect(a2.status).toBe(401);

    // 3rd attempt from same IP exceeds PORTALESS_MFA_ATTEMPTS_PER_IP=2
    const a3 = await loginMfa.onRequestPost(mfaVerifyCtx("203.0.113.1", challengeToken, currentTotpCode(TOTP_SECRET)));
    expect(a3.status).toBe(429);
    expect(a3.headers.get("cache-control")).toBe("no-store");
    expect(Number(a3.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // Another IP can still verify the valid challenge
    const otherIp = await loginMfa.onRequestPost(mfaVerifyCtx("203.0.113.2", challengeToken, currentTotpCode(TOTP_SECRET)));
    expect(otherIp.status).toBe(200);
    expect(otherIp.headers.get("cache-control")).toBe("no-store");
  });
});
