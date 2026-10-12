// functions/admin/api/apw-atproto-links.js (puente APW <-> AT): alta,
// listado y baja de handles AT que el sitio reclama en su did:apw via
// alsoKnownAs. Mismo patron que admin-mcp-agents-endpoint.test.ts:
// el factory del store se mockea para compartir UN store InMemory entre
// requests. Cubre 401 sin sesion, 403 para viewer, validacion sintactica
// AT del handle (parseHandle real), idempotencia y que GET nunca inventa
// campos.

import { describe, it, expect, vi, beforeEach } from "vitest";

const shared = vi.hoisted(() => ({
  store: undefined as import("../../packages/apw-resolver/src/did-apw/atproto-links-store").SiteAtprotoLinksStore | undefined,
}));

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/apw-resolver/src/did-apw/store-factory")>();
  const { InMemorySiteAtprotoLinksStore } = await import("../../packages/apw-resolver/src/did-apw/atproto-links-store");
  shared.store ??= new InMemorySiteAtprotoLinksStore();
  return {
    ...original,
    createSiteAtprotoLinksStore: async () => shared.store,
  };
});

import * as links from "../../functions/admin/api/apw-atproto-links";

const SITE_ID = "default";

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string } = {}) {
  const request = new Request("http://x.test/admin/api/apw-atproto-links", {
    method: opts.method ?? "POST",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    env: {},
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

beforeEach(async () => {
  const store = shared.store!;
  for (const link of await store.list(SITE_ID)) {
    await store.remove(SITE_ID, link.handle);
  }
});

describe("GET /admin/api/apw-atproto-links", () => {
  it("401 sin sesion; lista vinculos del sitio con admin", async () => {
    expect((await links.onRequestGet(ctx({ user: null }))).status).toBe(401);

    await links.onRequestPost(ctx({ user: { username: "a", role: "admin" }, body: { handle: "user.example.com" } }));
    const res = await links.onRequestGet(ctx({ user: { username: "v", role: "viewer" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({ siteId: SITE_ID, handle: "user.example.com" });
  });
});

describe("POST /admin/api/apw-atproto-links", () => {
  it("401 sin sesion y 403 para viewer", async () => {
    expect((await links.onRequestPost(ctx({ user: null, body: { handle: "a.b" } }))).status).toBe(401);
    expect(
      (await links.onRequestPost(ctx({ user: { username: "v", role: "viewer" }, body: { handle: "a.b" } }))).status
    ).toBe(403);
  });

  it("valida la sintaxis AT del handle y normaliza a minusculas", async () => {
    const admin = { username: "a", role: "admin" };
    const ok = await links.onRequestPost(ctx({ user: admin, body: { handle: "@User.Example.COM" } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).link).toMatchObject({ handle: "user.example.com" });

    for (const handle of ["nope", "jo@hn.test", "org", "user.test", 42, undefined]) {
      const res = await links.onRequestPost(ctx({ user: admin, body: { handle } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_handle");
    }

    const badJson = ctx({ user: admin });
    (badJson.request as Request) = new Request("http://x.test/admin/api/apw-atproto-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{basura",
    });
    expect((await links.onRequestPost(badJson)).status).toBe(400);
  });

  it("alta idempotente: repetir el mismo handle no duplica", async () => {
    const admin = { username: "a", role: "admin" };
    await links.onRequestPost(ctx({ user: admin, body: { handle: "user.example.com" } }));
    await links.onRequestPost(ctx({ user: admin, body: { handle: "user.example.com" } }));
    const body = await (await links.onRequestGet(ctx({ user: admin }))).json();
    expect(body.links).toHaveLength(1);
  });
});

describe("DELETE /admin/api/apw-atproto-links", () => {
  it("401/403 igual que POST, 400 sin handle valido", async () => {
    expect((await links.onRequestDelete(ctx({ user: null, body: { handle: "a.b" } }))).status).toBe(401);
    expect(
      (await links.onRequestDelete(ctx({ user: { username: "v", role: "viewer" }, body: { handle: "a.b" } }))).status
    ).toBe(403);
    expect((await links.onRequestDelete(ctx({ user: { username: "a", role: "admin" }, body: {} }))).status).toBe(400);
  });

  it("baja booleana: true si existia, false si no", async () => {
    const admin = { username: "a", role: "admin" };
    await links.onRequestPost(ctx({ user: admin, body: { handle: "user.example.com" } }));

    const first = await links.onRequestDelete(ctx({ user: admin, body: { handle: "user.example.com" } }));
    expect((await first.json()).removed).toBe(true);

    const second = await links.onRequestDelete(ctx({ user: admin, body: { handle: "user.example.com" } }));
    expect((await second.json()).removed).toBe(false);
  });
});
