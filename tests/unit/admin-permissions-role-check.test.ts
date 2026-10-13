import { describe, it, expect } from "vitest";
import { onRequestGet, onRequestPut } from "../../functions/admin/permissions/index.js";

function makeFakeD1() {
  const permissionRows = new Map<
    string,
    {
      subject_type: string;
      subject_id: string;
      subject_display_name: string;
      capability_id: string;
      granted: number;
      granted_at: string;
      granted_by: string | null;
    }
  >();

  const pluginRows = new Map<
    string,
    {
      plugin_id: string;
      display_name: string;
      author: string;
      source_type: string;
      manifest_json: string;
      registered_at: string;
      installed_at: string | null;
      active: number;
      trust_score: number;
      trust_score_votes: number;
      audited_by: string | null;
    }
  >();

  function permissionKey(subjectType: string, subjectId: string, capabilityId: string) {
    return `${subjectType}:${subjectId}:${capabilityId}`;
  }

  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return api;
        },
        async first() {
          if (sql.includes("FROM plugin_registry") && sql.includes("WHERE plugin_id")) {
            const [pluginId] = boundArgs as [string];
            return pluginRows.get(pluginId) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO permission_grants")) {
            const [subjectType, subjectId, subjectDisplayName, capabilityId, granted, grantedAt, grantedBy] =
              boundArgs as [string, string, string, string, number, string, string | null];
            permissionRows.set(permissionKey(subjectType, subjectId, capabilityId), {
              subject_type: subjectType,
              subject_id: subjectId,
              subject_display_name: subjectDisplayName,
              capability_id: capabilityId,
              granted,
              granted_at: grantedAt,
              granted_by: grantedBy,
            });
          }

          if (sql.includes("INSERT INTO plugin_registry")) {
            const [
              pluginId,
              displayName,
              author,
              sourceType,
              manifestJson,
              registeredAt,
              installedAt,
              active,
              trustScore,
              trustScoreVotes,
              auditedBy,
            ] = boundArgs as [
              string,
              string,
              string,
              string,
              string,
              string,
              string | null,
              number,
              number,
              number,
              string | null
            ];
            pluginRows.set(pluginId, {
              plugin_id: pluginId,
              display_name: displayName,
              author,
              source_type: sourceType,
              manifest_json: manifestJson,
              registered_at: registeredAt,
              installed_at: installedAt,
              active,
              trust_score: trustScore,
              trust_score_votes: trustScoreVotes,
              audited_by: auditedBy,
            });
          }

          return { success: true };
        },
        async all() {
          if (sql.includes("FROM plugin_registry")) {
            return { results: [...pluginRows.values()] };
          }
          if (sql.includes("WHERE subject_type")) {
            const [subjectType, subjectId] = boundArgs as [string, string];
            return {
              results: [...permissionRows.values()].filter(
                (r) => r.subject_type === subjectType && r.subject_id === subjectId
              ),
            };
          }
          return { results: [...permissionRows.values()] };
        },
      };
      return api;
    },
  };
}

function makeContext({
  user,
  body,
}: {
  user: { username: string; role: string } | null;
  body?: unknown;
}) {
  return {
    request: {
      json: async () => body,
    },
    data: { user },
    env: { DB: makeFakeD1() },
  } as any;
}

describe("functions/admin/permissions/index.js", () => {
  it("GET rechaza con 401 si no hay usuario autenticado", async () => {
    const ctx = makeContext({ user: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });

  it("GET no exige rol admin -- un viewer autenticado puede leer el snapshot", async () => {
    const ctx = makeContext({ user: { username: "viewer1", role: "viewer" } });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.grants)).toBe(true);
  });

  it("GET incluye los subjects conocidos con granted=false cuando el store esta vacio", async () => {
    const ctx = makeContext({ user: { username: "admin1", role: "admin" } });
    const res = await onRequestGet(ctx);
    const body = await res.json();

    const helloGrant = body.grants.find(
      (g: any) => g.subject.id === "hello-plugin" && g.capabilityId === "network:fetch"
    );
    expect(helloGrant).toBeDefined();
    expect(helloGrant.granted).toBe(false);

    const commerceGrant = body.grants.find(
      (g: any) => g.subject.id === "commerce-plugin" && g.capabilityId === "network:fetch"
    );
    expect(commerceGrant).toBeDefined();
    expect(commerceGrant.granted).toBe(false);
  });

  it("PUT rechaza con 401 si no hay usuario autenticado", async () => {
    const ctx = makeContext({
      user: null,
      body: { subject: { type: "plugin", id: "hello-plugin", displayName: "Hello" }, capabilityId: "network:fetch", granted: true },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(401);
  });

  it("PUT rechaza con 403 a un usuario con rol viewer (aunque este autenticado)", async () => {
    const ctx = makeContext({
      user: { username: "viewer1", role: "viewer" },
      body: { subject: { type: "plugin", id: "hello-plugin", displayName: "Hello" }, capabilityId: "network:fetch", granted: true },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(403);
  });

  it("PUT rechaza con 400 si el body no tiene la forma esperada", async () => {
    const ctx = makeContext({
      user: { username: "admin1", role: "admin" },
      body: { capabilityId: "network:fetch" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });

  it("PUT rechaza con 400 si el body no es JSON valido", async () => {
    const ctx = makeContext({ user: { username: "admin1", role: "admin" } });
    ctx.request.json = async () => {
      throw new Error("invalid json");
    };
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });

  it("PUT permite a un usuario admin conceder un permiso, y el GET posterior lo refleja persistido", async () => {
    const fakeDb = makeFakeD1();
    const env = { DB: fakeDb };

    const putCtx = {
      request: {
        json: async () => ({
          subject: { type: "plugin", id: "hello-plugin", displayName: "Hello Plugin (demo)" },
          capabilityId: "network:fetch",
          granted: true,
        }),
      },
      data: { user: { username: "admin1", role: "admin" } },
      env,
    } as any;

    const putRes = await onRequestPut(putCtx);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);

    const getCtx = { data: { user: { username: "admin1", role: "admin" } }, env } as any;
    const getRes = await onRequestGet(getCtx);
    const getBody = await getRes.json();

    const grant = getBody.grants.find(
      (g: any) => g.subject.id === "hello-plugin" && g.capabilityId === "network:fetch"
    );
    expect(grant).toBeDefined();
    expect(grant.granted).toBe(true);
    expect(grant.grantedBy).toBe("admin1");
  });

  it("PUT revoca un permiso previamente concedido (toggle en ambas direcciones)", async () => {
    const fakeDb = makeFakeD1();
    const env = { DB: fakeDb };
    const user = { username: "admin1", role: "admin" };
    const subject = { type: "plugin", id: "commerce-plugin", displayName: "Commerce Plugin (Medusa/Mercur)" };

    await onRequestPut({
      request: { json: async () => ({ subject, capabilityId: "network:fetch", granted: true }) },
      data: { user },
      env,
    } as any);

    const revokeRes = await onRequestPut({
      request: { json: async () => ({ subject, capabilityId: "network:fetch", granted: false }) },
      data: { user },
      env,
    } as any);
    expect(revokeRes.status).toBe(200);

    const getRes = await onRequestGet({ data: { user }, env } as any);
    const getBody = await getRes.json();
    const grant = getBody.grants.find(
      (g: any) => g.subject.id === "commerce-plugin" && g.capabilityId === "network:fetch"
    );
    expect(grant.granted).toBe(false);
  });

  it("PUT concede y revoca el bypass de lectura por DID de lector (APW 6.5)", async () => {
    const env = { DB: makeFakeD1() };
    const user = { username: "admin1", role: "admin" };
    const subject = { type: "reader", id: "did:apw:indice.example", displayName: "did:apw:indice.example" };
    const body = { subject, capabilityId: "trust:read-governance-bypass", granted: true };

    const grantRes = await onRequestPut({
      request: { json: async () => body },
      data: { user },
      env,
    } as any);
    expect(grantRes.status).toBe(200);

    const getBody = await (await onRequestGet({ data: { user }, env } as any)).json();
    const grant = getBody.grants.find(
      (g: any) => g.subject.type === "reader" && g.subject.id === subject.id && g.capabilityId === body.capabilityId
    );
    expect(grant).toMatchObject({ granted: true, grantedBy: "admin1" });

    const revokeRes = await onRequestPut({
      request: { json: async () => ({ ...body, granted: false }) },
      data: { user },
      env,
    } as any);
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await (await onRequestGet({ data: { user }, env } as any)).json();
    expect(
      afterRevoke.grants.find((g: any) => g.subject.id === subject.id && g.capabilityId === body.capabilityId).granted
    ).toBe(false);
  });

  it("PUT rechaza con 400 un subject reader con DID mal formado", async () => {
    const ctx = makeContext({
      user: { username: "admin1", role: "admin" },
      body: {
        subject: { type: "reader", id: "indice.example", displayName: "indice.example" },
        capabilityId: "trust:read-governance-bypass",
        granted: true,
      },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_reader_grant");
  });

  it("PUT rechaza con 400 una capacidad que no sea el bypass para un subject reader", async () => {
    const ctx = makeContext({
      user: { username: "admin1", role: "admin" },
      body: {
        subject: { type: "reader", id: "did:apw:indice.example", displayName: "did:apw:indice.example" },
        capabilityId: "site:admin",
        granted: true,
      },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_reader_grant");
  });
});

// Content negotiation (mismo patron que functions/trust/[siteId].js): la
// Function respondia JSON a TODO GET, asi que tapaba la UI del Centro de
// Permisos en self-host y en Cloudflare Pages (las funciones corren antes
// que los assets) -- dist/admin/permissions/index.html existia pero era
// inalcanzable para una persona. Con Accept: text/html se sirve el shell
// via env.ASSETS; el fetch() de la propia UI (Accept */*) sigue recibiendo
// el JSON.
describe("GET /admin/permissions: negociacion HTML vs JSON", () => {
  const USER = { username: "admin1", role: "admin" };
  const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  function browserContext(assets: unknown) {
    return {
      request: new Request("http://x.test/admin/permissions", { headers: { accept: BROWSER_ACCEPT } }),
      data: { user: USER },
      env: { DB: makeFakeD1(), ASSETS: assets },
    } as any;
  }

  it("Accept text/html + env.ASSETS: sirve el shell HTML de la pagina", async () => {
    const asked: string[] = [];
    const res = await onRequestGet(
      browserContext({
        fetch: async (input: any) => {
          asked.push(String(input instanceof Request ? input.url : input));
          return new Response("<html><body>Centro de Permisos</body></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        },
      })
    );
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Centro de Permisos");
    // Pide el directorio (index.html), no un asset arbitrario.
    expect(asked.some((u) => u.endsWith("/admin/permissions/"))).toBe(true);
  });

  it("Accept text/html pero el shell no existe (ASSETS 404): responde el JSON del snapshot", async () => {
    const res = await onRequestGet(
      browserContext({ fetch: async () => new Response("Not Found", { status: 404 }) })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(Array.isArray((await res.json()).grants)).toBe(true);
  });

  it("Accept text/html SIN env.ASSETS: responde JSON como antes (deploy sin binding)", async () => {
    const ctx = browserContext(undefined);
    delete (ctx.env as any).ASSETS;
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("el fetch() de la propia UI (Accept */*): sigue siendo JSON y no delega al shell", async () => {
    const res = await onRequestGet({
      request: new Request("http://x.test/admin/permissions", { headers: { accept: "*/*" } }),
      data: { user: USER },
      env: {
        DB: makeFakeD1(),
        ASSETS: {
          fetch: async () => {
            throw new Error("no debe delegar para clientes JSON");
          },
        },
      },
    } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(Array.isArray((await res.json()).grants)).toBe(true);
  });

  it("sin sesion: 401 aunque pida HTML (la autenticacion va antes de negociar)", async () => {
    const res = await onRequestGet({
      request: new Request("http://x.test/admin/permissions", { headers: { accept: BROWSER_ACCEPT } }),
      data: { user: null },
      env: {
        DB: makeFakeD1(),
        ASSETS: {
          fetch: async () => {
            throw new Error("no debe servir el shell sin sesion");
          },
        },
      },
    } as any);
    expect(res.status).toBe(401);
  });
});
