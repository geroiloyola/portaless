// v0.0.9.27 -- flujo de manifiesto de GitHub App con la conversion mockeada.
import { describe, it, expect, vi } from "vitest";
import { InMemoryDeploymentOAuthStore } from "../../packages/deploy-engine/src/oauth-store";
import {
  InMemoryProviderConfigStore,
  GITHUB_APP_PROVIDER_ID,
  getProviderConfig,
} from "../../packages/deploy-engine/src/providers-config-store";
import { beginGitHubManifest, completeGitHubManifest, buildGitHubAppManifest } from "../../packages/deploy-engine/src/github-manifest";
import { readGitHubOAuthConfig } from "../../packages/deploy-engine/src/github-oauth";

const KEY = "k".repeat(40);
const ORIGIN = "https://site.test";
const APP = {
  id: 123, slug: "portaless-site-test-ab12", client_id: "Iv1.dyn", client_secret: "dyn-secret",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nX\n-----END RSA PRIVATE KEY-----", webhook_secret: "wh",
  html_url: "https://github.com/apps/portaless-site-test-ab12",
};
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(APP), { status: 201 }));

async function startFlow(oauthStore: InMemoryDeploymentOAuthStore, user = "u1") {
  const html = await beginGitHubManifest(oauthStore, user, ORIGIN);
  return decodeURIComponent(/state=([^"&]+)/.exec(html)![1]);
}

describe("GitHub App manifest", () => {
  it("el manifiesto apunta a esta instancia y el nombre respeta el limite de 34", () => {
    const m = buildGitHubAppManifest(ORIGIN);
    expect(m.redirect_url).toBe(`${ORIGIN}/admin/api/oauth/github/manifest/callback`);
    expect(m.callback_urls).toEqual([`${ORIGIN}/admin/api/oauth/github/callback`]);
    expect(m.public).toBe(false);
    expect(m.name.length).toBeLessThanOrEqual(34);
  });

  it("begin devuelve un form POST a GitHub con state y manifest escapado", async () => {
    const html = await beginGitHubManifest(new InMemoryDeploymentOAuthStore(), "u1", ORIGIN);
    expect(html).toContain('method="post" action="https://github.com/settings/apps/new?state=');
    expect(html).toContain('name="manifest" value="{&quot;name&quot;');
  });

  it("complete canjea el code, guarda secretos CIFRADOS y OAuth pasa a usar la config dinamica", async () => {
    const oauthStore = new InMemoryDeploymentOAuthStore();
    const providerStore = new InMemoryProviderConfigStore();
    const f = okFetch();
    const state = await startFlow(oauthStore);
    const r = await completeGitHubManifest({ oauthStore, providerStore, encryptionKey: KEY, fetchImpl: f as any }, { code: "abc123", state }, "u1");

    expect(r).toEqual({ ok: true, appSlug: APP.slug, installUrl: `${APP.html_url}/installations/new` });
    expect(String(f.mock.calls[0][0])).toBe("https://api.github.com/app-manifests/abc123/conversions");

    const row = await providerStore.get(GITHUB_APP_PROVIDER_ID);
    expect(row!.client_secret_enc).not.toContain("dyn-secret");
    expect(row!.private_key_enc).not.toContain("PRIVATE KEY");
    expect(row!.webhook_secret_enc).not.toBe("wh");
    expect((await getProviderConfig(providerStore, GITHUB_APP_PROVIDER_ID, KEY))!.privateKey).toBe(APP.pem);

    const cfg = await readGitHubOAuthConfig({ PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: KEY }, ORIGIN, providerStore);
    expect(cfg).toMatchObject({ clientId: "Iv1.dyn", clientSecret: "dyn-secret" });
  });

  it("state de otra sesion: 403 y no se canjea el code", async () => {
    const oauthStore = new InMemoryDeploymentOAuthStore();
    const f = okFetch();
    const state = await startFlow(oauthStore, "u1");
    const r = await completeGitHubManifest({ oauthStore, providerStore: new InMemoryProviderConfigStore(), encryptionKey: KEY, fetchImpl: f as any }, { code: "abc", state }, "atacante");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(f).not.toHaveBeenCalled();
  });

  it("si ya hay App registrada: 409 ANTES del canje (no deja Apps huerfanas)", async () => {
    const oauthStore = new InMemoryDeploymentOAuthStore();
    const providerStore = new InMemoryProviderConfigStore();
    await completeGitHubManifest({ oauthStore, providerStore, encryptionKey: KEY, fetchImpl: okFetch() as any }, { code: "a1", state: await startFlow(oauthStore) }, "u1");
    const f = okFetch();
    const r = await completeGitHubManifest({ oauthStore, providerStore, encryptionKey: KEY, fetchImpl: f as any }, { code: "a2", state: await startFlow(oauthStore) }, "u1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(f).not.toHaveBeenCalled();
  });

  it("falla de persistencia despues del canje devuelve orphanHtmlUrl", async () => {
    const oauthStore = new InMemoryDeploymentOAuthStore();
    const broken = { get: async () => null, insert: async () => { throw new Error("D1 caida"); } };
    const r = await completeGitHubManifest({ oauthStore, providerStore: broken, encryptionKey: KEY, fetchImpl: okFetch() as any }, { code: "abc", state: await startFlow(oauthStore) }, "u1");
    expect(r).toMatchObject({ ok: false, status: 500, orphanHtmlUrl: APP.html_url });
  });

  it("conversion rechazada por GitHub: 502 sin guardar nada", async () => {
    const oauthStore = new InMemoryDeploymentOAuthStore();
    const providerStore = new InMemoryProviderConfigStore();
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
    const r = await completeGitHubManifest({ oauthStore, providerStore, encryptionKey: KEY, fetchImpl: f as any }, { code: "abc", state: await startFlow(oauthStore) }, "u1");
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(await providerStore.get(GITHUB_APP_PROVIDER_ID)).toBeNull();
  });

  it("code con caracteres de path es rechazado sin tocar la red", async () => {
    const f = okFetch();
    const r = await completeGitHubManifest({ oauthStore: new InMemoryDeploymentOAuthStore(), providerStore: new InMemoryProviderConfigStore(), encryptionKey: KEY, fetchImpl: f as any }, { code: "../../user", state: "x" }, "u1");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(f).not.toHaveBeenCalled();
  });

  it("sin config dinamica, readGitHubOAuthConfig cae a las env vars", async () => {
    const cfg = await readGitHubOAuthConfig(
      { PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: KEY, PORTALESS_GITHUB_APP_CLIENT_ID: "Iv1.env", PORTALESS_GITHUB_APP_CLIENT_SECRET: "env-s" },
      ORIGIN,
      new InMemoryProviderConfigStore()
    );
    expect(cfg).toMatchObject({ clientId: "Iv1.env", clientSecret: "env-s" });
  });
});
