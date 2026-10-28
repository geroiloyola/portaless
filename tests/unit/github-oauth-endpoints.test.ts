// A-06: el par start -> callback debe usar la misma identidad de sesion.
// Antes start guardaba "undefined" (g.user.id ?? g.user.email) y callback
// comparaba contra "admin", asi que GitHub siempre respondia 403.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDeploymentOAuthStore } from "../../packages/deploy-engine/src/oauth-store";

const mocks = vi.hoisted(() => ({
  store: null as any,
  readConfig: vi.fn(),
}));

vi.mock("../../packages/deploy-engine/src/oauth-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/deploy-engine/src/oauth-store")>();
  return { ...original, createDeploymentOAuthStore: async () => mocks.store };
});

vi.mock("../../packages/deploy-engine/src/github-oauth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/deploy-engine/src/github-oauth")>();
  return { ...original, readGitHubOAuthConfig: mocks.readConfig };
});

import * as start from "../../functions/admin/api/oauth/github/start";
import * as callback from "../../functions/admin/api/oauth/github/callback";

const ORIGIN = "https://site.test";
const USER = { username: "admin", role: "admin" };

function context(request: Request, user = USER) {
  return {
    request,
    env: { PORTALESS_PUBLIC_URL: ORIGIN },
    data: { user },
    params: {},
    next: async () => new Response("static"),
  } as any;
}

function fetchOk() {
  return vi.fn(async (url: string) => {
    if (String(url).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "ghu_test", refresh_token: "ghr_test", expires_in: 28800 }));
    }
    return new Response(JSON.stringify({ login: "gh-admin" }));
  });
}

beforeEach(() => {
  mocks.store = new InMemoryDeploymentOAuthStore();
  mocks.readConfig.mockReset();
  mocks.readConfig.mockResolvedValue({
    clientId: "Iv1.test",
    clientSecret: "secret",
    redirectUri: `${ORIGIN}/admin/api/oauth/github/callback`,
    encryptionKey: "k".repeat(40),
    fetchImpl: fetchOk(),
  });
});

describe("GitHub deployment OAuth endpoints", () => {
  it("start -> callback con la misma sesion guarda la credencial", async () => {
    const startRes = await start.onRequestGet(context(new Request(`${ORIGIN}/admin/api/oauth/github/start`)));
    expect(startRes.status).toBe(302);
    const state = new URL(startRes.headers.get("location")!).searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackRes = await callback.onRequestGet(context(
      new Request(`${ORIGIN}/admin/api/oauth/github/callback?code=abc&state=${state}`)
    ));
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get("location")).toBe(`${ORIGIN}/admin/wizard/step-2-infrastructure?github=connected`);
    const credential = await mocks.store.getCredential("github");
    expect(credential?.connectedBy).toBe(USER.username);
  });

  it("un callback con otra sesion no consume el state ni guarda credencial", async () => {
    const startRes = await start.onRequestGet(context(new Request(`${ORIGIN}/admin/api/oauth/github/start`)));
    const state = new URL(startRes.headers.get("location")!).searchParams.get("state");

    const callbackRes = await callback.onRequestGet(context(
      new Request(`${ORIGIN}/admin/api/oauth/github/callback?code=abc&state=${state}`),
      { username: "otro", role: "admin" }
    ));
    expect(callbackRes.status).toBe(403);
    expect(await mocks.store.getCredential("github")).toBeNull();
  });

  it("sin PORTALESS_PUBLIC_URL falla cerrado en vez de usar Host", async () => {
    const req = new Request(`${ORIGIN}/admin/api/oauth/github/start`);
    const res = await start.onRequestGet({
      request: req,
      env: {},
      data: { user: USER },
      params: {},
      next: async () => new Response("static"),
    } as any);
    expect(res.status).toBe(503);
  });
});
