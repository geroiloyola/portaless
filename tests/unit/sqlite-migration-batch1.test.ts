// v0.0.9.27 -- tanda 1 de la migracion node:sqlite -> openSqlite.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPermissionStore } from "../../packages/permissions/src/store-factory";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { SqlitePermissionStore } from "../../packages/permissions/src/stores/sqlite-permission-store";
import { createSiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/store-factory";
import { SqliteSiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { SqliteUsersStore } from "../../packages/auth/src/stores/sqlite-users-store";
import { onRequestGet as adminStatus } from "../../functions/admin/api/wizard/admin-status.js";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-b1-")), "db.sqlite");

afterEach(() => vi.unstubAllGlobals());

describe("permissions sobre better-sqlite3", () => {
  it("con PORTALESS_SQLITE_PATH no cae a memoria y persiste entre instancias", async () => {
    const path = tmpPath();
    const a = await createPermissionStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemoryPermissionStore);
    await a.setGrant({
      subject: { type: "plugin", id: "p1", displayName: "P1" } as any,
      capabilityId: "content:read" as any,
      granted: true,
      grantedAt: new Date().toISOString(),
    } as any);
    const b = await createPermissionStore({ PORTALESS_SQLITE_PATH: path });
    expect((await b.getAllGrants()).map((g) => g.capabilityId)).toEqual(["content:read"]);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqlitePermissionStore("/tmp/x.db" as any)).toThrow(/SqlitePermissionStore.open/);
  });
});

describe("site-identity factory", () => {
  it("con PORTALESS_SQLITE_PATH usa SqliteSiteIdentityStore sobre better-sqlite3", async () => {
    expect(await createSiteIdentityStore({ PORTALESS_SQLITE_PATH: tmpPath() })).toBeInstanceOf(SqliteSiteIdentityStore);
  });
});

describe("GET /admin/api/wizard/admin-status", () => {
  it("refleja lo que el login va a encontrar (mismo UsersStore)", async () => {
    const path = tmpPath();
    const env = { PORTALESS_SQLITE_PATH: path };
    expect(await (await adminStatus({ env } as any)).json()).toEqual({ adminExists: false, backend: "sqlite" });

    const store = await SqliteUsersStore.open(path);
    await store.createUser("admin", "clave-de-prueba-123", "admin" as any);
    store.close();
    expect(await (await adminStatus({ env } as any)).json()).toEqual({ adminExists: true, backend: "sqlite" });
  });

  it("si el backend falla responde 503, no adminExists:false", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const res = await adminStatus({ env: { PORTALESS_SQLITE_PATH: tmpPath() } } as any);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_unavailable");
  });
});
