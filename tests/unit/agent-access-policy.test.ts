// ROADMAP.md fase 12 (§12.1 + §12.2): la politica de acceso de agentes pasa a
// ser operable desde el panel.
//
// Cubre tres cosas que antes no tenian ninguna prueba:
//  1. La precedencia store > asset > default (resolveContentPolicy), incluido
//     el caso que importa de verdad: un store con JSON corrupto NO se aplica,
//     cae al asset en vez de dejar el sitio sin politica.
//  2. La validacion del store: no se puede guardar un access invalido ni un
//     "charge" sin precio (seria una politica que el middleware no puede cobrar).
//  3. El endpoint /admin/api/agents: sesion, guard de rol del lado del servidor,
//     y que el "site" lo fija el servidor y no el body.
//
// Sigue el patron de admin-agents-status-endpoints.test.ts: el factory del
// store se mockea con una instancia en memoria compartida, porque el real crea
// uno nuevo por peticion y el estado se perderia.

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

import {
  SqlAgentAccessPolicyStore,
  InMemoryAgentAccessPolicyStore,
  validateAgentAccessPolicy,
  INVALID_AGENT_ACCESS_POLICY,
} from "../../packages/trust-layer/src/policy/agent-access-store";
import { resolveContentPolicy, loadContentPolicy } from "../../packages/trust-layer/src/policy/load-policy";
import { defaultContentPolicy, type ContentPolicyManifest } from "../../packages/trust-layer/src/policy/manifest-schema";

const SITE = "https://sitio.test";

function manifest(overrides: Partial<ContentPolicyManifest["policies"]> = {}): ContentPolicyManifest {
  return {
    version: "0.1",
    site: SITE,
    policies: {
      search: { access: "allow", price_usd: 0 },
      ai_input: { access: "charge", price_usd: 0.002, unit: "request" },
      ai_train: { access: "block" },
      ...overrides,
    },
    free_for: [],
    contact: "",
  };
}

/** AssetsFetcher de mentira que devuelve el manifiesto dado. */
function assetsServing(value: unknown) {
  return {
    fetch: async () => new Response(JSON.stringify(value), { status: 200 }),
  } as unknown as NonNullable<Parameters<typeof resolveContentPolicy>[1]>;
}

describe("agent_access_policy store", () => {
  it("SQLite: sin fila, read() devuelve null (el sitio usa el asset)", async () => {
    const store = new SqlAgentAccessPolicyStore(new Database(":memory:"));
    expect(await store.read()).toBeNull();
  });

  it("SQLite: escribe y lee; el registro lleva quien y cuando", async () => {
    const db = new Database(":memory:");
    const store = new SqlAgentAccessPolicyStore(db);
    const saved = await store.write(manifest({ ai_train: { access: "allow" } }), "duena");

    const read = await store.read();
    expect(read?.policy.policies.ai_train.access).toBe("allow");
    expect(read?.updatedBy).toBe("duena");
    expect(read?.updatedAt).toBe(saved.updatedAt);
  });

  it("SQLite: una sola fila (id = 1); escribir de nuevo actualiza, no acumula", async () => {
    const db = new Database(":memory:");
    const store = new SqlAgentAccessPolicyStore(db);
    await store.write(manifest(), "primero");
    await store.write(manifest({ ai_input: { access: "block" } }), "segundo");

    const rows = db.prepare("SELECT COUNT(*) AS n FROM agent_access_policy").get() as { n: number };
    expect(rows.n).toBe(1);
    expect((await store.read())?.updatedBy).toBe("segundo");
  });

  it("clear() borra el override y el sitio vuelve al asset", async () => {
    const store = new SqlAgentAccessPolicyStore(new Database(":memory:"));
    await store.write(manifest(), "duena");
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("rechaza access invalido y charge sin precio", async () => {
    const store = new InMemoryAgentAccessPolicyStore();
    await expect(
      store.write(manifest({ ai_input: { access: "maybe" as never } }), "duena")
    ).rejects.toThrow(INVALID_AGENT_ACCESS_POLICY);
    await expect(store.write(manifest({ ai_input: { access: "charge" } }), "duena")).rejects.toThrow(
      INVALID_AGENT_ACCESS_POLICY
    );
    await expect(store.write(manifest({ ai_input: { access: "charge", price_usd: 0 } }), "duena")).rejects.toThrow(
      INVALID_AGENT_ACCESS_POLICY
    );
    expect(await store.read()).toBeNull();
  });

  it("descarta campos que el panel no controla (free_for, contact, settlement_provider)", async () => {
    const store = new InMemoryAgentAccessPolicyStore();
    const saved = await store.write(
      { ...manifest(), settlement_provider: "cloudflare-pay-per-crawl" } as ContentPolicyManifest,
      "duena"
    );
    expect(saved.policy).not.toHaveProperty("settlement_provider");
    expect(saved.policy.version).toBe("0.1");
  });

  it("un JSON corrupto en la fila NO se aplica: read() devuelve null y avisa", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE agent_access_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1), policy_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
    )`);
    db.prepare("INSERT INTO agent_access_policy (id, policy_json, updated_at, updated_by) VALUES (1, ?, ?, ?)").run(
      "{no es json",
      new Date().toISOString(),
      "alguien"
    );

    const store = new SqlAgentAccessPolicyStore(db);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await store.read()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("una politica guardada pero invalida tampoco se aplica", async () => {
    const db = new Database(":memory:");
    const store = new SqlAgentAccessPolicyStore(db);
    db.prepare("INSERT INTO agent_access_policy (id, policy_json, updated_at, updated_by) VALUES (1, ?, ?, ?)").run(
      JSON.stringify({ version: "0.1", site: SITE, policies: { search: { access: "allow" }, ai_input: { access: "nope" } } }),
      new Date().toISOString(),
      "alguien"
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await store.read()).toBeNull();
    warn.mockRestore();
  });

  it("validateAgentAccessPolicy acepta las tres reglas completas y rechaza Manifest incompletos", () => {
    expect(validateAgentAccessPolicy(manifest())).toBe(true);
    expect(validateAgentAccessPolicy({ version: "0.1", site: SITE, policies: { search: { access: "allow" } } })).toBe(
      false
    );
    expect(validateAgentAccessPolicy(null)).toBe(false);
    expect(validateAgentAccessPolicy("allow")).toBe(false);
  });
});

describe("precedencia store > asset > default", () => {
  it("sin store ni asset: la politica por defecto, origen 'default'", async () => {
    const resolved = await resolveContentPolicy(SITE);
    expect(resolved.source).toBe("default");
    expect(resolved.policy).toEqual(defaultContentPolicy(SITE));
  });

  it("solo asset: gana el asset", async () => {
    const resolved = await resolveContentPolicy(SITE, assetsServing(manifest({ ai_train: { access: "allow" } })));
    expect(resolved.source).toBe("asset");
    expect(resolved.policy.policies.ai_train.access).toBe("allow");
  });

  it("store + asset: gana el store, y trae quien lo escribio", async () => {
    const store = new InMemoryAgentAccessPolicyStore(manifest({ ai_input: { access: "block" } }));
    const resolved = await resolveContentPolicy(SITE, assetsServing(manifest()), store);
    expect(resolved.source).toBe("store");
    expect(resolved.policy.policies.ai_input.access).toBe("block");
    expect(resolved.updatedBy).toBe("test-seed");
  });

  it("store vacio: cae al asset", async () => {
    const resolved = await resolveContentPolicy(SITE, assetsServing(manifest()), new InMemoryAgentAccessPolicyStore());
    expect(resolved.source).toBe("asset");
  });

  it("store que lanza (tabla que no existe todavia): cae al asset, no rompe la peticion", async () => {
    const brokenStore = {
      read: async () => {
        throw new Error("no such table: agent_access_policy");
      },
    } as never;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = await resolveContentPolicy(SITE, assetsServing(manifest({ ai_train: { access: "allow" } })), brokenStore);
    expect(resolved.source).toBe("asset");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("asset invalido + store vacio: la politica por defecto, no una politica a medias", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = await resolveContentPolicy(SITE, assetsServing({ version: "0.1", site: SITE, policies: {} }));
    expect(resolved.source).toBe("default");
    expect(resolved.policy.policies.ai_input.access).toBe("charge");
    warn.mockRestore();
  });

  it("loadContentPolicy sigue devolviendo solo la politica (compat con el middleware)", async () => {
    const store = new InMemoryAgentAccessPolicyStore(manifest({ ai_train: { access: "allow" } }));
    expect((await loadContentPolicy(SITE, undefined, store)).policies.ai_train.access).toBe("allow");
  });
});

describe("/admin/api/agents", () => {
  const sharedStore = new InMemoryAgentAccessPolicyStore();

  beforeEach(async () => {
    await sharedStore.clear();
    vi.doMock("../../packages/trust-layer/src/policy/agent-access-store", async (importOriginal) => {
      const original = await importOriginal<typeof import("../../packages/trust-layer/src/policy/agent-access-store")>();
      return { ...original, createAgentAccessPolicyStore: async () => sharedStore };
    });
  });

  function ctx(opts: { user?: { username: string; role: string } | null; method?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const request = new Request("https://sitio.test/admin/api/agents", {
      method: opts.method ?? "GET",
      headers,
      body,
    });
    return {
      request,
      env: {},
      params: {},
      data: opts.user ? { user: opts.user } : {},
      next: async () => new Response("static"),
    } as any;
  }

  async function loadEndpoint() {
    vi.resetModules();
    return import("../../functions/admin/api/agents");
  }

  it("GET sin sesion: 401", async () => {
    const mod = await loadEndpoint();
    expect((await mod.onRequestGet(ctx({ user: null }))).status).toBe(401);
  });

  it("GET con sesion devuelve la politica efectiva con su origen y si el rol puede escribir", async () => {
    const mod = await loadEndpoint();
    const res = await mod.onRequestGet(ctx({ user: { username: "ana", role: "viewer" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("default");
    expect(body.policy.policies.ai_train.access).toBe("block");
    expect(body.writable).toBe(false);
    expect(body.policyPath).toBe("/.well-known/portaless-content-policy.json");
  });

  it("PUT con role viewer: 403 y no escribe nada", async () => {
    const mod = await loadEndpoint();
    const res = await mod.onRequestPut(
      ctx({
        user: { username: "ana", role: "viewer" },
        method: "PUT",
        body: { policies: { search: { access: "allow" }, ai_input: { access: "block" }, ai_train: { access: "block" } } },
      })
    );
    expect(res.status).toBe(403);
    expect(await sharedStore.read()).toBeNull();
  });

  it("PUT con role admin guarda el override y GET pasa a|source=store", async () => {
    const mod = await loadEndpoint();
    const res = await mod.onRequestPut(
      ctx({
        user: { username: "ana", role: "admin" },
        method: "PUT",
        body: {
          policies: {
            search: { access: "allow" },
            ai_input: { access: "charge", price_usd: 0.01, unit: "request" },
            ai_train: { access: "block" },
          },
        },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("store");

    const after = await mod.onRequestGet(ctx({ user: { username: "ana", role: "admin" } }));
    const body = await after.json();
    expect(body.source).toBe("store");
    expect(body.updatedBy).toBe("ana");
    expect(body.policy.policies.ai_input.price_usd).toBe(0.01);
  });

  it("PUT con una regla invalida: 400 y no guarda", async () => {
    const mod = await loadEndpoint();
    const res = await mod.onRequestPut(
      ctx({
        user: { username: "ana", role: "admin" },
        method: "PUT",
        body: { policies: { search: { access: "allow" }, ai_input: { access: "charge" }, ai_train: { access: "block" } } },
      })
    );
    expect(res.status).toBe(400);
    expect(await sharedStore.read()).toBeNull();
  });

  it("PUT no puede publicar una politica de otro sitio: el site lo fija el servidor", async () => {
    const mod = await loadEndpoint();
    const res = await mod.onRequestPut(
      ctx({
        user: { username: "ana", role: "admin" },
        method: "PUT",
        body: {
          site: "https://sitio-de-otro.test",
          policies: {
            search: { access: "allow" },
            ai_input: { access: "block" },
            ai_train: { access: "block" },
          },
        },
      })
    );
    expect(res.status).toBe(200);
    expect((await sharedStore.read())?.policy.site).toBe(SITE);
  });

  it("DELETE con role admin borra el override y devuelve la politica que queda", async () => {
    const mod = await loadEndpoint();
    await mod.onRequestPut(
      ctx({
        user: { username: "ana", role: "admin" },
        method: "PUT",
        body: { policies: { search: { access: "allow" }, ai_input: { access: "block" }, ai_train: { access: "block" } } },
      })
    );

    const res = await mod.onRequestDelete(ctx({ user: { username: "ana", role: "admin" }, method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("default");
    expect(body.policy.policies.ai_input.access).toBe("charge");
    expect(await sharedStore.read()).toBeNull();
  });

  it("DELETE sin sesion: 401", async () => {
    const mod = await loadEndpoint();
    expect((await mod.onRequestDelete(ctx({ user: null, method: "DELETE" }))).status).toBe(401);
  });
});
