import { describe, it, expect, vi } from "vitest";
import { InMemoryDeploymentOAuthStore } from "../../packages/deploy-engine/src/oauth-store";
import { beginGitHubOAuth, completeGitHubOAuth, getGitHubAccessToken } from "../../packages/deploy-engine/src/github-oauth";
import { decryptToken } from "../../packages/deploy-engine/src/token-crypto";

const KEY = "k".repeat(40);
function cfg(fetchImpl?: any) {
  return { clientId: "Iv1.test", clientSecret: "sec", redirectUri: "https://site.test/admin/api/oauth/github/callback", encryptionKey: KEY, fetchImpl };
}
function okFetch() {
  return vi.fn(async (url: string) => String(url).includes("access_token")
    ? new Response(JSON.stringify({ access_token: "ghu_abc", refresh_token: "ghr_def", expires_in: 28800, refresh_token_expires_in: 15897600 }))
    : new Response(JSON.stringify({ login: "geroiloyola" })));
}

describe("GitHub OAuth de despliegue", () => {
  it("start genera URL con state y PKCE S256", async () => {
    const store = new InMemoryDeploymentOAuthStore();
    const u = new URL(await beginGitHubOAuth(cfg(), store, "u1"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toHaveLength(43);
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("callback valido guarda tokens CIFRADOS y envia code_verifier", async () => {
    const store = new InMemoryDeploymentOAuthStore();
    const f = okFetch();
    const state = new URL(await beginGitHubOAuth(cfg(), store, "u1")).searchParams.get("state");
    const r = await completeGitHubOAuth(cfg(f), store, { code: "c", state }, "u1");
    expect(r).toEqual({ ok: true, accountLogin: "geroiloyola" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.code_verifier).toBeTruthy();
    const c = await store.getCredential("github");
    expect(c!.accessTokenEnc).not.toContain("ghu_abc");
    expect(await decryptToken(c!.accessTokenEnc, KEY)).toBe("ghu_abc");
    expect(await getGitHubAccessToken(cfg(), store)).toBe("ghu_abc");
  });

  it("state reutilizado es rechazado (un solo uso)", async () => {
    const store = new InMemoryDeploymentOAuthStore();
    const state = new URL(await beginGitHubOAuth(cfg(), store, "u1")).searchParams.get("state");
    await completeGitHubOAuth(cfg(okFetch()), store, { code: "c", state }, "u1");
    const r = await completeGitHubOAuth(cfg(okFetch()), store, { code: "c", state }, "u1");
    expect(r.ok).toBe(false);
  });

  it("state de otra sesion devuelve 403 (anti login-CSRF)", async () => {
    const store = new InMemoryDeploymentOAuthStore();
    const state = new URL(await beginGitHubOAuth(cfg(), store, "u1")).searchParams.get("state");
    const r = await completeGitHubOAuth(cfg(okFetch()), store, { code: "c", state }, "atacante");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("error de GitHub en el intercambio se propaga como 502 sin guardar nada", async () => {
    const store = new InMemoryDeploymentOAuthStore();
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "bad_verification_code" })));
    const state = new URL(await beginGitHubOAuth(cfg(), store, "u1")).searchParams.get("state");
    const r = await completeGitHubOAuth(cfg(f), store, { code: "x", state }, "u1");
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(await store.getCredential("github")).toBeNull();
  });
});
