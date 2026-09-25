// v0.0.9.27: con PORTALESS_SQLITE_PATH definido, el factory de auth NUNCA
// debe devolver un store en memoria. Reproduce el escenario real: setup crea
// el admin en el .db y el runtime (login) tiene que encontrarlo.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsersStore, createSessionStore, createPasswordResetStore } from "../../packages/auth/src/store-factory";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";
import { InMemoryPasswordResetStore } from "../../packages/auth/src/password-reset-store";
import { SqliteUsersStore } from "../../packages/auth/src/stores/sqlite-users-store";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-auth-")), "auth.db");

describe("store-factory de auth con PORTALESS_SQLITE_PATH", () => {
  it("ningun factory cae a memoria", async () => {
    const env = { PORTALESS_SQLITE_PATH: tmpPath() };
    expect(await createUsersStore(env)).not.toBeInstanceOf(InMemoryUsersStore);
    expect(await createSessionStore(env)).not.toBeInstanceOf(InMemorySessionStore);
    expect(await createPasswordResetStore(env)).not.toBeInstanceOf(InMemoryPasswordResetStore);
  });

  it("el admin creado por setup (conexion separada) es visible para el runtime", async () => {
    const path = tmpPath();
    const setupStore = await SqliteUsersStore.open(path);
    await setupStore.createUser("admin", "clave-de-prueba-123", "admin" as any);
    setupStore.close();

    const runtimeStore = await createUsersStore({ PORTALESS_SQLITE_PATH: path });
    expect((await runtimeStore.findByUsername("admin"))?.role).toBe("admin");
  });

  it("la sesion persiste entre instancias del store", async () => {
    const path = tmpPath();
    const s = await (await createSessionStore({ PORTALESS_SQLITE_PATH: path })).create("admin", "admin" as any);
    const again = await createSessionStore({ PORTALESS_SQLITE_PATH: path });
    expect((await again.get(s.token))?.username).toBe("admin");
  });

  it("un token de reset solo se consume una vez", async () => {
    const store = await createPasswordResetStore({ PORTALESS_SQLITE_PATH: tmpPath() });
    const req = await store.create("admin");
    expect(await store.consume(req.token)).not.toBeNull();
    expect(await store.consume(req.token)).toBeNull();
  });

  it("sin DB ni ruta, sigue cayendo a memoria (comportamiento documentado)", async () => {
    expect(await createUsersStore({})).toBeInstanceOf(InMemoryUsersStore);
  });
});
