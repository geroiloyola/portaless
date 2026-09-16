import { describe, it, expect } from "vitest";
import { onRequestGet, onRequestPut } from "../../functions/admin/permissions/index.js";

// Mock minimo de D1Database en memoria -- implementa solo lo que
// D1PermissionStore usa (prepare().bind().all()/run()). Evita que
// createPermissionStore() caiga al fallback SqlitePermissionStore, que
// requiere node:sqlite y escribiria un archivo real en disco como efecto
// secundario del test si env.DB fuera undefined.
//
// NOTA: el binding se llama `DB` aqui (coincide con packages/permissions/
// src/store-factory.ts, packages/auth/src/store-factory.ts y el binding
// documentado en wrangler.toml), NO `PORTALESS_DB` como en
// functions/admin/pages/[slug].js (que usa createPageStore, con su propio
// nombre de campo distinto en packages/atomic-elements/src/persistence/
// store-factory.ts). Son 2 factories distintas con convenciones de
// nombre de env distintas -- confirmar el nombre exacto en cada
// store-factory.ts antes de copiar este patron a un endpoint nuevo.
function makeFakeD1() {
  const rows = new Map<
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

  function key(subjectType: string, subjectId: string, capabilityId: string) {
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
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO permission_grants")) {
            const [subjectType, subjectId, subjectDisplayName, capabilityId, granted, grantedAt, grantedBy] =
              boundArgs as [string, string, string, string, number, string, string | null];
            rows.set(key(subjectType, subjectId, capabilityId), {
              subject_type: subjectType,
              subject_id: subjectId,
              subject_display_name: subjectDisplayName,
              capability_id: capabilityId,
              granted,
              granted_at: grantedAt,
              granted_by: grantedBy,
            });
          }
          return { success: true };
        },
        async all() {
          if (sql.includes("WHERE subject_type")) {
            const [subjectType, subjectId] = boundArgs as [string, string];
            return {
              results: [...rows.values()].filter(
                (r) => r.subject_type === subjectType && r.subject_id === subjectId
              ),
            };
          }
          return { results: [...rows.values()] };
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
      body: { capabilityId: "network:fetch" }, // falta subject y granted
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
});
