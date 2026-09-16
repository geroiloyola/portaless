// Tests unitarios de las 3 features nuevas de v0.0.9.4: 2FA (TOTP),
// recuperacion de contrasena, y OAuth/SSO. Usa los stores en memoria
// (InMemoryUsersStore, InMemorySessionStore, InMemoryPasswordResetStore)
// -- no requiere D1/SQLite real, igual que los tests preexistentes de
// AuthService antes de este PR.

import { describe, it, expect, vi } from "vitest";
import { AuthService } from "../../packages/auth/src/auth-service";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";
import { InMemoryPasswordResetStore } from "../../packages/auth/src/password-reset-store";
import * as oauth from "../../packages/auth/src/oauth";
import { createHmac } from "node:crypto";

function buildAuth() {
  const users = new InMemoryUsersStore();
  const sessions = new InMemorySessionStore();
  const resets = new InMemoryPasswordResetStore();
  return { users, sessions, resets, auth: new AuthService(users, sessions, resets) };
}

describe("2FA (TOTP)", () => {
  it("login sin 2FA activo se comporta exactamente igual que antes de v0.0.9.4", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("alice", "hunter2hunter2", "admin");
    const result = await auth.login("alice", "hunter2hunter2");
    expect(result.success).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
    expect(result.session?.username).toBe("alice");
  });

  it("enrolamiento completo: begin -> confirm con codigo valido activa 2FA", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("bob", "hunter2hunter2", "admin");
    const { secret } = await auth.beginTotpEnrollment("bob");

    const counter = Math.floor(Date.now() / 1000 / 30);
    const validCode = computeCodeForTest(secret, counter);

    const confirmed = await auth.confirmTotpEnrollment("bob", secret, validCode);
    expect(confirmed).toBe(true);

    const stored = await users.findByUsername("bob");
    expect(stored?.totpSecret).toBe(secret);
  });

  it("login con 2FA activo requiere segundo paso antes de emitir sesion", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("carol", "hunter2hunter2", "admin");
    const { secret } = await auth.beginTotpEnrollment("carol");
    const validCode = computeCodeForTest(secret, Math.floor(Date.now() / 1000 / 30));
    await auth.confirmTotpEnrollment("carol", secret, validCode);

    const loginResult = await auth.login("carol", "hunter2hunter2");
    expect(loginResult.success).toBe(false);
    expect(loginResult.mfaRequired).toBe(true);
    expect(loginResult.mfaChallengeToken).toBeTruthy();

    const secondCode = computeCodeForTest(secret, Math.floor(Date.now() / 1000 / 30));
    const finalResult = await auth.completeMfaLogin(loginResult.mfaChallengeToken!, secondCode);
    expect(finalResult.success).toBe(true);
    expect(finalResult.session?.mfaVerified).toBe(true);
  });

  it("completeMfaLogin rechaza un codigo incorrecto sin emitir sesion", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("dave", "hunter2hunter2", "admin");
    const { secret } = await auth.beginTotpEnrollment("dave");
    const validCode = computeCodeForTest(secret, Math.floor(Date.now() / 1000 / 30));
    await auth.confirmTotpEnrollment("dave", secret, validCode);

    const loginResult = await auth.login("dave", "hunter2hunter2");
    const wrongAttempt = await auth.completeMfaLogin(loginResult.mfaChallengeToken!, "000000");
    expect(wrongAttempt.success).toBe(false);
  });

  it("disableTotp permite volver a login directo sin segundo paso", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("erin", "hunter2hunter2", "admin");
    const { secret } = await auth.beginTotpEnrollment("erin");
    const validCode = computeCodeForTest(secret, Math.floor(Date.now() / 1000 / 30));
    await auth.confirmTotpEnrollment("erin", secret, validCode);
    await auth.disableTotp("erin");

    const result = await auth.login("erin", "hunter2hunter2");
    expect(result.success).toBe(true);
    expect(result.mfaRequired).toBeUndefined();
  });
});

describe("Recuperacion de contraseña", () => {
  it("requestPasswordReset + completePasswordReset permite loguear con la contraseña nueva", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("frank", "oldpassword1", "admin");

    const req = await auth.requestPasswordReset("frank");
    expect(req?.token).toBeTruthy();

    const confirmResult = await auth.completePasswordReset(req!.token, "newpassword2");
    expect(confirmResult.success).toBe(true);

    const oldLogin = await auth.login("frank", "oldpassword1");
    expect(oldLogin.success).toBe(false);

    const newLogin = await auth.login("frank", "newpassword2");
    expect(newLogin.success).toBe(true);
  });

  it("requestPasswordReset para un usuario inexistente no revela el error (devuelve null silenciosamente)", async () => {
    const { auth } = buildAuth();
    const req = await auth.requestPasswordReset("no-existe");
    expect(req).toBeNull();
  });

  it("un token de reset usado una vez no puede reutilizarse", async () => {
    const { users, auth } = buildAuth();
    await users.createUser("grace", "oldpassword1", "admin");
    const req = await auth.requestPasswordReset("grace");

    await auth.completePasswordReset(req!.token, "newpassword2");
    const secondAttempt = await auth.completePasswordReset(req!.token, "anotherpassword3");
    expect(secondAttempt.success).toBe(false);
  });
});

describe("OAuth/SSO", () => {
  it("loginWithOAuth crea un usuario nuevo la primera vez que se ve ese subject", async () => {
    const { users, auth } = buildAuth();
    const result = await auth.loginWithOAuth({
      provider: "google",
      subject: "sub-123",
      email: "hank@example.com",
      displayName: "Hank",
    });

    expect(result.success).toBe(true);
    const stored = await users.findByUsername("hank@example.com");
    expect(stored?.provider).toBe("oauth");
    expect(stored?.oauthProvider).toBe("google");
  });

  it("loginWithOAuth reutiliza la cuenta si el mismo subject ya inicio sesion antes", async () => {
    const { auth } = buildAuth();
    const profile = { provider: "github", subject: "gh-456", email: "iris@example.com" };
    const first = await auth.loginWithOAuth(profile);
    const second = await auth.loginWithOAuth(profile);

    expect(first.session?.username).toBe(second.session?.username);
  });

  it("loadOAuthProviderConfig devuelve null si el proveedor no esta configurado", () => {
    const config = oauth.loadOAuthProviderConfig("google", {}, "https://example.com/callback");
    expect(config).toBeNull();
  });

  it("exchangeCodeForProfile usa fetchImpl inyectado, sin llamada de red real", async () => {
    const config = oauth.loadOAuthProviderConfig(
      "google",
      {
        PORTALESS_OAUTH_GOOGLE_CLIENT_ID: "id",
        PORTALESS_OAUTH_GOOGLE_CLIENT_SECRET: "secret",
        PORTALESS_OAUTH_GOOGLE_AUTH_URL: "https://accounts.google.com/o/oauth2/auth",
        PORTALESS_OAUTH_GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
        PORTALESS_OAUTH_GOOGLE_USERINFO_URL: "https://openidconnect.googleapis.com/v1/userinfo",
      },
      "https://example.com/callback"
    );
    expect(config).not.toBeNull();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "sub-789", email: "j@example.com" }) });

    const profile = await oauth.exchangeCodeForProfile(config!, "code", "verifier", mockFetch as any);
    expect(profile.subject).toBe("sub-789");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

function computeCodeForTest(secret: string, counter: number): string {
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const key = Buffer.from(bytes);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** 6).padStart(6, "0");
}
