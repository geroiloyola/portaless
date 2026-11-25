// functions/admin/oauth/[provider]/{start,callback}.js: valida provider,
// scope por proveedor, state+PKCE ligado a portaless_oauth_state_<provider>
// (M-07), intercambia el codigo y crea la sesion.

import { describe, it, expect, vi } from "vitest";

vi.mock("@portaless/auth/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { sharedInMemoryMfaChallengeStore, InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  const users = new InMemoryUsersStore();
  const sessions = new InMemorySessionStore();
  const rateLimits = new InMemoryRateLimitStore();
  return {
    createUsersStore: async () => users,
    createSessionStore: async () => sessions,
    createMfaChallengeStore: async () => sharedInMemoryMfaChallengeStore,
    createRateLimitStore: async () => rateLimits,
    createPasswordResetStore: async () => ({ invalidateAllForUser: async () => {} }),
  };
});

const oauth = vi.hoisted(() => ({ exchangeCodeForProfile: vi.fn() }));
vi.mock("@portaless/auth/oauth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@portaless/auth/oauth")>();
  return { ...original, exchangeCodeForProfile: oauth.exchangeCodeForProfile };
});

import * as start from "../../functions/admin/oauth/[provider]/start";
import * as callback from "../../functions/admin/oauth/[provider]/callback";

const env = {
  PORTALESS_OAUTH_GITHUB_CLIENT_ID: "cid",
  PORTALESS_OAUTH_GITHUB_CLIENT_SECRET: "csecret",
  PORTALESS_OAUTH_GITHUB_AUTH_URL: "https://github.com/login/oauth/authorize",
  PORTALESS_OAUTH_GITHUB_TOKEN_URL: "https://github.com/login/oauth/access_token",
  PORTALESS_OAUTH_GITHUB_USERINFO_URL: "https://api.github.com/user",
};

function get(opts: {
  origin?: string;
  query?: string;
  stateCookie?: string | null;
  cookieName?: string;
  provider?: string;
  extraEnv?: Record<string, string>;
} = {}) {
  const origin = opts.origin ?? "http://x.test";
  const provider = opts.provider ?? "github";
  const query = opts.query ?? "code=abc&state=st-1";
  const headers: Record<string, string> = {};
  if (opts.stateCookie !== null) {
    const cookieName = opts.cookieName ?? `portaless_oauth_state_${provider}`;
    const value = opts.stateCookie ?? `${provider}:st-1:verifier-1`;
    headers["Cookie"] = `${cookieName}=${encodeURIComponent(value)}`;
  }
  const context = {
    request: new Request(`${origin}/admin/oauth/${provider}/callback?${query}`, { headers }),
    env: { ...env, PORTALESS_PUBLIC_URL: origin, ...(opts.extraEnv ?? {}) },
    params: { provider },
    data: {},
    next: async () => new Response("static"),
  } as any;
  return callback.onRequestGet(context);
}

function location(res: Response): string {
  return res.headers.get("location")!;
}

describe("functions/admin/oauth/[provider]/{start,callback}.js (M-07)", () => {
  it("M-07: start emite scope configurable por proveedor y cookie portaless_oauth_state_<provider>", async () => {
    const res = await start.onRequestGet({
      request: new Request("https://x.test/admin/oauth/github/start"),
      env: { ...env, PORTALESS_PUBLIC_URL: "https://x.test", PORTALESS_OAUTH_GITHUB_SCOPE: "read:user user:email" },
      params: { provider: "github" },
    } as any);
    expect(res.status).toBe(302);
    const authUrl = new URL(location(res));
    expect(authUrl.searchParams.get("scope")).toBe("read:user user:email");
    expect(authUrl.searchParams.get("state")).toBeTruthy();

    const cookies = res.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("portaless_oauth_state_github="))!;
    expect(stateCookie).toBeTruthy();
    expect(stateCookie).toContain("Path=/admin/oauth/github/callback");
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");
    expect(stateCookie).toContain("Secure");
  });

  it("M-07: rechaza nombres de proveedor invalidos o inyectados con 400 antes de tocar cookies", async () => {
    for (const bad of ["github; Path=/", "../evil", "bad$provider", ""]) {
      const startRes = await start.onRequestGet({
        request: new Request("https://x.test/admin/oauth/bad/start"),
        env: { ...env, PORTALESS_PUBLIC_URL: "https://x.test" },
        params: { provider: bad },
      } as any);
      expect(startRes.status, `start ${bad}`).toBe(400);

      const cbRes = await get({ provider: bad, stateCookie: null });
      expect(cbRes.status, `callback ${bad}`).toBe(400);
    }
  });

  it("M-07: rechaza mismatch de proveedor contra state y limpia la cookie (Max-Age=0)", async () => {
    // Caso 1: cookie de otro proveedor (portaless_oauth_state_google) enviada al callback de github
    const wrongCookieName = await get({
      provider: "github",
      cookieName: "portaless_oauth_state_google",
      stateCookie: "google:st-1:verifier-1",
    });
    expect(wrongCookieName.status).toBe(302);
    expect(location(wrongCookieName)).toBe("http://x.test/admin/login?error=1");
    expect(wrongCookieName.headers.getSetCookie().find((c) => c.startsWith("portaless_oauth_state_github="))).toContain("Max-Age=0");

    // Caso 2: valor interno ligado a google dentro de la cookie portaless_oauth_state_github
    const wrongInnerProvider = await get({
      provider: "github",
      cookieName: "portaless_oauth_state_github",
      stateCookie: "google:st-1:verifier-1",
    });
    expect(wrongInnerProvider.status).toBe(302);
    expect(location(wrongInnerProvider)).toBe("http://x.test/admin/login?error=1");
    expect(wrongInnerProvider.headers.getSetCookie().find((c) => c.startsWith("portaless_oauth_state_github="))).toContain("Max-Age=0");
  });

  it("sin code/state, sin cookie o con state que no coincide: redirect a error y limpia cookie", async () => {
    expect(location(await get({ query: "" }))).toBe("http://x.test/admin/login?error=1");
    expect(location(await get({ query: "code=abc" }))).toBe("http://x.test/admin/login?error=1");
    expect(location(await get({ stateCookie: null }))).toBe("http://x.test/admin/login?error=1");
    const mismatch = await get({ stateCookie: "github:otro:verifier" });
    expect(location(mismatch)).toBe("http://x.test/admin/login?error=1");
    expect(mismatch.headers.getSetCookie().find((c) => c.startsWith("portaless_oauth_state_github="))).toContain("Max-Age=0");
  });

  it("proveedor no configurado en el despliegue: 404 explicito", async () => {
    const res = await get({ provider: "gitlab" });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("gitlab");
  });

  it("fallo el intercambio con el proveedor: redirect a error y limpia state cookie", async () => {
    oauth.exchangeCodeForProfile.mockRejectedValueOnce(new Error("token invalido"));
    const res = await get();
    expect(res.status).toBe(302);
    expect(location(res)).toBe("http://x.test/admin/login?error=1");
    expect(res.headers.getSetCookie().find((c) => c.startsWith("portaless_oauth_state_github="))).toContain("Max-Age=0");
  });

  it("exito sobre http: 302 a /admin, sesion y limpieza de portaless_oauth_state_github (sin Secure)", async () => {
    oauth.exchangeCodeForProfile.mockResolvedValueOnce({
      provider: "github",
      subject: "gh-123",
      email: "carol@example.com",
      name: "Carol",
    });
    const res = await get();
    expect(res.status).toBe(302);
    expect(location(res)).toBe("http://x.test/admin");
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("portaless_session="))!;
    expect(session).toContain("Path=/");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Strict");
    expect(session).toContain("Max-Age=86400");
    expect(session).not.toContain("Secure");
    const cleared = cookies.find((c) => c.startsWith("portaless_oauth_state_github="))!;
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/admin/oauth/github/callback");
  });

  it("C-01: un usuario OAuth con TOTP va a login-mfa y no recibe cookie de sesion", async () => {
    const factory = await import("@portaless/auth/store-factory");
    const users = await factory.createUsersStore({});
    await users.createUser("oauth-mfa@example.com", "OAuth-Mfa-Pass-123!", "admin", "oauth-mfa@example.com");
    await users.setTotpSecret("oauth-mfa@example.com", "OAUTHMFA2FASECRET");
    await users.linkOAuthAccount("oauth-mfa@example.com", "github", "gh-mfa-1");
    oauth.exchangeCodeForProfile.mockResolvedValueOnce({
      provider: "github",
      subject: "gh-mfa-1",
      email: "oauth-mfa@example.com",
      emailVerified: true,
    });

    const res = await get();
    expect(res.status).toBe(302);
    const redirect = new URL(location(res));
    expect(redirect.pathname).toBe("/admin/login-mfa");
    expect(redirect.searchParams.get("challenge")).toBeTruthy();
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("portaless_session="))).toBe(false);
    expect(cookies.find((c) => c.startsWith("portaless_oauth_state_github="))).toContain("Max-Age=0");
  });

  it("sin PORTALESS_PUBLIC_URL falla cerrado en vez de usar Host", async () => {
    const request = new Request("http://evil.attacker.example/admin/oauth/github/callback?code=abc&state=st-1", {
      headers: { Cookie: "portaless_oauth_state_github=github%3Ast-1%3Averifier-1" },
    });
    const res = await callback.onRequestGet({
      request,
      env,
      params: { provider: "github" },
      data: {},
      next: async () => new Response("static"),
    } as any);
    expect(res.status).toBe(503);
  });

  it("sobre https ambas cookies llevan Secure; el usuario OAuth se crea en el store", async () => {
    oauth.exchangeCodeForProfile.mockResolvedValueOnce({
      provider: "github",
      subject: "gh-999",
      email: "nuevo@example.com",
    });
    const res = await get({ origin: "https://x.test" });
    expect(res.status).toBe(302);
    for (const cookie of res.headers.getSetCookie()) {
      expect(cookie).toContain("Secure");
    }
    const factory = await import("@portaless/auth/store-factory");
    const users = await factory.createUsersStore({});
    const user = await users.findByOAuthSubject("github", "gh-999");
    expect(user?.email).toBe("nuevo@example.com");
  });
});
