// functions/admin/oauth/[provider]/callback.js: valida state+PKCE,
// intercambia el codigo y crea la sesion. A 0% de cobertura. Se usa el
// AuthService REAL con stores compartidos en memoria y
// loadOAuthProviderConfig REAL (con env de prueba); solo se mockea
// exchangeCodeForProfile (red al proveedor).

import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/auth/src/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { sharedInMemoryMfaChallengeStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  const users = new InMemoryUsersStore();
  const sessions = new InMemorySessionStore();
  return {
    createUsersStore: async () => users,
    createSessionStore: async () => sessions,
    createMfaChallengeStore: async () => sharedInMemoryMfaChallengeStore,
    createPasswordResetStore: async () => ({ invalidateAllForUser: async () => {} }),
  };
});

const oauth = vi.hoisted(() => ({ exchangeCodeForProfile: vi.fn() }));
vi.mock("../../packages/auth/src/oauth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/auth/src/oauth")>();
  return { ...original, exchangeCodeForProfile: oauth.exchangeCodeForProfile };
});

import * as callback from "../../functions/admin/oauth/[provider]/callback";

const env = {
  PORTALESS_OAUTH_GITHUB_CLIENT_ID: "cid",
  PORTALESS_OAUTH_GITHUB_CLIENT_SECRET: "csecret",
  PORTALESS_OAUTH_GITHUB_AUTH_URL: "https://github.com/login/oauth/authorize",
  PORTALESS_OAUTH_GITHUB_TOKEN_URL: "https://github.com/login/oauth/access_token",
  PORTALESS_OAUTH_GITHUB_USERINFO_URL: "https://api.github.com/user",
};

function get(opts: { origin?: string; query?: string; stateCookie?: string | null; provider?: string } = {}) {
  const origin = opts.origin ?? "http://x.test";
  const query = opts.query ?? "code=abc&state=st-1";
  const headers: Record<string, string> = {};
  if (opts.stateCookie !== null) {
    headers["Cookie"] = `portaless_oauth_state=${encodeURIComponent(opts.stateCookie ?? "st-1:verifier-1")}`;
  }
  const context = {
    request: new Request(`${origin}/admin/oauth/${opts.provider ?? "github"}/callback?${query}`, { headers }),
    env: { ...env, PORTALESS_PUBLIC_URL: origin },
    params: { provider: opts.provider ?? "github" },
    data: {},
    next: async () => new Response("static"),
  } as any;
  return callback.onRequestGet(context);
}

function location(res: Response): string {
  return res.headers.get("location")!;
}

describe("functions/admin/oauth/[provider]/callback.js", () => {
  it("sin code/state, sin cookie o con state que no coincide: redirect a error", async () => {
    expect(location(await get({ query: "" }))).toBe("http://x.test/admin/login?error=1");
    expect(location(await get({ query: "code=abc" }))).toBe("http://x.test/admin/login?error=1");
    expect(location(await get({ stateCookie: null }))).toBe("http://x.test/admin/login?error=1");
    expect(location(await get({ stateCookie: "otro:verifier" }))).toBe("http://x.test/admin/login?error=1");
  });

  it("proveedor no configurado en el despliegue: 404 explicito", async () => {
    const res = await get({ provider: "gitlab" });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("gitlab");
  });

  it("fallo el intercambio con el proveedor: redirect a error", async () => {
    oauth.exchangeCodeForProfile.mockRejectedValueOnce(new Error("token invalido"));
    const res = await get();
    expect(res.status).toBe(302);
    expect(location(res)).toBe("http://x.test/admin/login?error=1");
  });

  it("exito sobre http: 302 a /admin, sesion y limpieza del state cookie (sin Secure)", async () => {
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
    const cleared = cookies.find((c) => c.startsWith("portaless_oauth_state="))!;
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/admin/oauth/github/callback");
  });

  it("C-01: un usuario OAuth con TOTP va a login-mfa y no recibe cookie de sesion", async () => {
    const factory = await import("../../packages/auth/src/store-factory");
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
    expect(cookies.find((c) => c.startsWith("portaless_oauth_state="))).toContain("Max-Age=0");
  });

  it("sin PORTALESS_PUBLIC_URL falla cerrado en vez de usar Host", async () => {
    const request = new Request("http://evil.attacker.example/admin/oauth/github/callback?code=abc&state=st-1", {
      headers: { Cookie: "portaless_oauth_state=st-1:verifier-1" },
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
    const users = await (await import("../../packages/auth/src/store-factory")).createUsersStore({});
    const created = await users.findByUsername("nuevo@example.com");
    expect(created?.provider).toBe("oauth"); // metodo de auth
    expect(created?.oauthProvider).toBe("github"); // proveedor real
    expect(created?.oauthSubject).toBe("gh-999");
  });
});
