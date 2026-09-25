// Regresion del item 6 (self-host SQLite), v0.0.9.27. Reproduce las 3 fallas
// encontradas ejecutando setup en Node 20: admin no persistido, tabla
// deployment_credentials inexistente, y node:sqlite en el token store.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteUsersStore } from "../../packages/auth/src/stores/sqlite-users-store";
import { createDeploymentOAuthStore } from "../../packages/deploy-engine/src/oauth-store";
import { createCapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store-factory";

function freshDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), "portaless-")), "test.db");
  const db = new Database(path);
  db.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf-8"));
  db.close();
  return path;
}

describe("self-host SQLite (better-sqlite3, Node >= 20)", () => {
  it("schema.sql maestro crea las tablas de OAuth de despliegue y del bridge", () => {
    const db = new Database(freshDb(), { readonly: true });
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    db.close();
    for (const t of ["users", "capability_bridge_tokens", "deployment_oauth_states", "deployment_credentials"]) {
      expect(names).toContain(t);
    }
  });

  it("el admin creado sobrevive a cerrar y reabrir el archivo", async () => {
    const path = freshDb();
    const store = await SqliteUsersStore.open(path);
    await store.createUser("admin", "clave-de-prueba-123", "admin" as any);
    store.close();

    const db = new Database(path, { readonly: true });
    const row = db.prepare("SELECT count(*) AS n FROM users WHERE username='admin' AND role='admin'").get() as { n: number };
    db.close();
    expect(row.n).toBe(1);
  });

  it("el constructor rechaza una ruta string con error explicito", () => {
    expect(() => new SqliteUsersStore("/tmp/x.db" as any)).toThrow(/SqliteUsersStore.open/);
  });

  it("createDeploymentOAuthStore persiste credenciales en SQLite real", async () => {
    const store = await createDeploymentOAuthStore({ PORTALESS_SQLITE_PATH: freshDb() });
    await store.saveCredential({
      provider: "github", accountLogin: "octo", accessTokenEnc: "v1.a.b", refreshTokenEnc: null,
      accessExpiresAt: null, refreshExpiresAt: null, connectedBy: "u1", updatedAt: new Date().toISOString(),
    });
    expect((await store.getCredential("github"))?.accountLogin).toBe("octo");
  });

  it("createCapabilityTokenStore abre SQLite sin node:sqlite", async () => {
    const store = await createCapabilityTokenStore({ PORTALESS_SQLITE_PATH: freshDb() });
    expect((await store.validate("pless_inexistente")).valid).toBe(false);
  });
});
