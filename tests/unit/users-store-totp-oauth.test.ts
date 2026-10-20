// UsersStore real (SQLite y D1) con la superficie completa de TOTP y OAuth.
// Regresion de ROADMAP: setTotpSecret/clearTotpSecret/findByOAuthSubject/
// linkOAuthAccount/createOAuthUser existian solo en InMemoryUsersStore, y
// la tabla users canonica no tenia columnas para ellos -- habilitar 2FA o
// login con OAuth en self-host/D1 reventaba con "not a function" (misma
// clase de bug que el setPasswordByUsername que ya se habia arreglado).
//
// Cada store se prueba con schema nuevo y con una DB Portaless completa cuyo
// users conserva la forma histórica de 4 columnas (pre-v0.0.9.10). El runner
// aplica v3 antes de abrir el store y conserva la fila existente.
// Ademas: integracion con AuthService real (confirmTotpEnrollment +
// verifyStepUp con codigo TOTP calculado de verdad, y loginWithOAuth
// creando/buscando usuarios via los metodos reales).

import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteUsersStore } from "../../packages/auth/src/stores/sqlite-users-store";
import { D1UsersStore, type D1DatabaseLike } from "../../packages/auth/src/stores/d1-users-store";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store";
import { verifyPassword } from "../../packages/auth/src/password";
import { AuthService } from "../../packages/auth/src/auth-service";
import { openSqlite } from "../../packages/sqlite-driver/src/open";
import { migrateSqlite } from "../../packages/persistence-migrations/src/runner";
import { applySchema } from "../../scripts/setup.mjs";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-users-store-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "portaless.db");
}

/** DB Portaless completa con la tabla users de cuatro columnas + una fila. */
async function seedLegacyUsersTable(dbPath: string): Promise<void> {
  await applySchema(dbPath, { quiet: true });
  const legacy = await openSqlite(dbPath);
  legacy.exec("DROP INDEX IF EXISTS idx_users_oauth");
  for (const column of ["email", "provider", "totp_secret", "totp_enabled_at", "oauth_provider", "oauth_subject"]) {
    legacy.exec(`ALTER TABLE users DROP COLUMN ${column}`);
  }
  legacy.exec("DELETE FROM schema_migrations WHERE version >= 3");
  legacy.prepare("INSERT OR REPLACE INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)")
    .run("legacy-admin", "scrypt:old:hash", "admin", "2026-01-01T00:00:00.000Z");
  legacy.close();
}

/** Fake D1DatabaseLike sobre better-sqlite3 (mismo patron que webbotauth-nonce-store.test.ts), con meta.changes en run(). */
function fakeD1(database: any): D1DatabaseLike {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

/** Codigo TOTP valido ahora para el secret dado (RFC 6238 SHA1/6d/30s, igual que totp.ts). */
function currentTotpCode(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const key = Buffer.from(
    normalized.split("").flatMap((ch) => {
      const idx = alphabet.indexOf(ch);
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        const byte = (value >> bits) & 0xff;
        return [byte];
      }
      return [];
    })
  );
  const counter = Math.floor(now / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** 6).padStart(6, "0");
}

async function assertFullSurface(store: SqliteUsersStore | D1UsersStore | InMemoryUsersStore) {
  // createUser con email: el email se persiste y provider queda "password".
  const created = await store.createUser("alice", "Alice-Pass-1!", "admin", "alice@example.com");
  expect(created.email).toBe("alice@example.com");
  expect(created.provider).toBe("password");
  const found = await store.findByUsername("alice");
  expect(found?.email).toBe("alice@example.com");
  expect(found?.provider).toBe("password");
  expect(found?.totpSecret).toBeUndefined();
  expect(found?.oauthSubject).toBeUndefined();

  // setPasswordByUsername (regression del item anterior) sigue funcionando.
  await store.setPasswordByUsername("alice", "Alice-Pass-2!");
  const afterPassword = await store.findByUsername("alice");
  expect(verifyPassword("Alice-Pass-2!", afterPassword!.passwordHash)).toBe(true);
  expect(verifyPassword("Alice-Pass-1!", afterPassword!.passwordHash)).toBe(false);

  // TOTP: set + clear, y error explicito si el usuario no existe.
  await store.setTotpSecret("alice", "JBSWY3DPEHPK3PXP");
  const withTotp = await store.findByUsername("alice");
  expect(withTotp?.totpSecret).toBe("JBSWY3DPEHPK3PXP");
  expect(withTotp?.totpEnabledAt).toBeTruthy();
  await store.clearTotpSecret("alice");
  const withoutTotp = await store.findByUsername("alice");
  expect(withoutTotp?.totpSecret).toBeUndefined();
  expect(withoutTotp?.totpEnabledAt).toBeUndefined();
  await expect(store.setTotpSecret("no-existe", "SECRET")).rejects.toThrow(/no existe/);
  await expect(store.clearTotpSecret("no-existe")).rejects.toThrow(/no existe/);

  // OAuth: vincular una cuenta existente y encontrarla por (provider, subject).
  await store.linkOAuthAccount("alice", "github", "gh-123");
  const bySubject = await store.findByOAuthSubject("github", "gh-123");
  expect(bySubject?.username).toBe("alice");
  expect(bySubject?.oauthProvider).toBe("github");
  expect(bySubject?.oauthSubject).toBe("gh-123");
  expect(await store.findByOAuthSubject("github", "otro")).toBeNull();
  expect(await store.findByOAuthSubject("google", "gh-123")).toBeNull();
  await expect(store.linkOAuthAccount("no-existe", "github", "x")).rejects.toThrow(/no existe/);

  // createOAuthUser: provider oauth, email persistido, hash aleatorio inutilizable.
  const oauthUser = await store.createOAuthUser("bob", "google", "go-99", "viewer", "bob@example.com");
  expect(oauthUser.provider).toBe("oauth");
  expect(oauthUser.email).toBe("bob@example.com");
  const foundBob = await store.findByOAuthSubject("google", "go-99");
  expect(foundBob?.username).toBe("bob");
  expect(foundBob?.role).toBe("viewer");
  expect(verifyPassword("bob@example.com", foundBob!.passwordHash)).toBe(false);
  expect(verifyPassword("oauth-managed", foundBob!.passwordHash)).toBe(false);
  await expect(store.createOAuthUser("bob", "google", "go-100", "viewer")).rejects.toThrow(/ya existe/);
  await expect(store.setPasswordByUsername("no-existe", "x")).rejects.toThrow(/no existe/);

  // listUsers incluye a los tres y sus campos nuevos.
  const all = await store.listUsers();
  expect(all.map((u) => u.username).sort()).toEqual(["alice", "bob"]);
  expect(all.find((u) => u.username === "alice")?.oauthProvider).toBe("github");
}

describe("SqliteUsersStore (base nueva)", () => {
  it("implementa la superficie completa de UsersStore (email, password, TOTP, OAuth)", async () => {
    const store = await SqliteUsersStore.open(tempDbPath());
    await assertFullSurface(store);
    store.close();
  });
});

describe("SqliteUsersStore (base vieja de 4 columnas)", () => {
  it("runner aplica v3 a la DB histórica y conserva la fila existente", async () => {
    const path = tempDbPath();
    await seedLegacyUsersTable(path);
    await migrateSqlite(path); // las columnas nuevas las aplica la migracion v3
    const store = await SqliteUsersStore.open(path);

    const legacy = await store.findByUsername("legacy-admin");
    expect(legacy?.role).toBe("admin");
    expect(legacy?.passwordHash).toBe("scrypt:old:hash");
    expect(legacy?.email).toBeUndefined();
    expect(legacy?.totpSecret).toBeUndefined();

    // Los metodos nuevos funcionan encima de la tabla migrada.
    await store.setTotpSecret("legacy-admin", "NEWSHEETSECRET");
    expect((await store.findByUsername("legacy-admin"))?.totpSecret).toBe("NEWSHEETSECRET");
    await store.linkOAuthAccount("legacy-admin", "github", "legacy-1");
    expect((await store.findByOAuthSubject("github", "legacy-1"))?.username).toBe("legacy-admin");

    // Abrir una segunda vez no revienta con "duplicate column".
    store.close();
    const reopened = await SqliteUsersStore.open(path);
    expect((await reopened.findByUsername("legacy-admin"))?.totpSecret).toBe("NEWSHEETSECRET");
    reopened.close();
  });
});

describe("D1UsersStore (D1 fake sobre better-sqlite3)", () => {
  it("crea el schema en la primera operacion e implementa la superficie completa", async () => {
    const db = await openSqlite(tempDbPath());
    const store = new D1UsersStore(fakeD1(db));
    await assertFullSurface(store);
    db.close();
  });

  it("migra una base vieja de 4 columnas sin perder la fila existente", async () => {
    const path = tempDbPath();
    await seedLegacyUsersTable(path);
    await migrateSqlite(path); // las columnas nuevas las aplica la migracion v3
    const db = await openSqlite(path);
    const store = new D1UsersStore(fakeD1(db));

    const legacy = await store.findByUsername("legacy-admin");
    expect(legacy?.role).toBe("admin");
    expect(legacy?.email).toBeUndefined();

    await store.setTotpSecret("legacy-admin", "D1SECRET");
    expect((await store.findByUsername("legacy-admin"))?.totpSecret).toBe("D1SECRET");
    db.close();
  });
});

describe("AuthService + users store real (integracion)", () => {
  it("habilita TOTP de verdad y verifyStepUp exige el codigo", async () => {
    const store = await SqliteUsersStore.open(tempDbPath());
    const { createSessionStore, createPasswordResetStore } = await import(
      "../../packages/auth/src/store-factory"
    );
    const { createPasswordEventStore } = await import("../../packages/auth/src/password-event-store");
    const auth = new AuthService(
      store,
      await createSessionStore({}),
      await createPasswordResetStore({}),
      await createPasswordEventStore({})
    );

    await store.createUser("carol", "Carol-Pass-1!", "admin");
    const { secret } = await auth.beginTotpEnrollment("carol");
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    // Sin el codigo correcto no se confirma.
    expect(await auth.confirmTotpEnrollment("carol", secret, "000000")).toBe(false);
    expect((await store.findByUsername("carol"))?.totpSecret).toBeUndefined();

    // Con el codigo real (calculado con la misma RFC 6238) si se confirma.
    expect(await auth.confirmTotpEnrollment("carol", secret, currentTotpCode(secret))).toBe(true);
    const enabled = await store.findByUsername("carol");
    expect(enabled?.totpSecret).toBe(secret);
    expect(enabled?.totpEnabledAt).toBeTruthy();

    // Step-up ahora exige password + TOTP; un codigo viejo/incorrecto falla.
    const wrong = await auth.verifyStepUp("carol", { password: "Carol-Pass-1!", totpCode: "000000" });
    expect(wrong).toEqual({ ok: false, reason: "invalid_totp" });
    const ok = await auth.verifyStepUp("carol", {
      password: "Carol-Pass-1!",
      totpCode: currentTotpCode(secret),
    });
    expect(ok).toEqual({ ok: true });

    // disableTotp vuelve al factor unico password.
    await auth.disableTotp("carol");
    expect((await store.findByUsername("carol"))?.totpSecret).toBeUndefined();
    const afterDisable = await auth.verifyStepUp("carol", { password: "Carol-Pass-1!" });
    expect(afterDisable).toEqual({ ok: true });
    store.close();
  });

  it("loginWithOAuth crea y luego encuentra usuarios via los metodos reales", async () => {
    const store = await SqliteUsersStore.open(tempDbPath());
    const { createSessionStore } = await import("../../packages/auth/src/store-factory");
    const auth = new AuthService(store, await createSessionStore({}));

    // Primera vez: no existe el (provider, subject) ni el username derivado
    // (con email, deriveUsernameFromProfile usa el email como username) ->
    // createOAuthUser.
    const first = await auth.loginWithOAuth({ provider: "github", subject: "gh-77", email: "dave@example.com" });
    expect(first.success).toBe(true);
    expect(first.session?.username).toBe("dave@example.com");
    const created = await store.findByOAuthSubject("github", "gh-77");
    expect(created?.provider).toBe("oauth");
    expect(created?.email).toBe("dave@example.com");

    // Segunda vez: lo encuentra por (provider, subject), sin duplicar.
    const second = await auth.loginWithOAuth({ provider: "github", subject: "gh-77" });
    expect(second.success).toBe(true);
    expect(second.session?.username).toBe("dave@example.com");
    expect(await store.listUsers()).toHaveLength(1);

    // Camino de vinculacion: el username derivado (el email) ya existe como
    // usuario password -> linkOAuthAccount sin tocar su provider ni password.
    await store.createUser("eve@example.com", "Eve-Pass-1!", "viewer");
    const linked = await auth.loginWithOAuth({ provider: "github", subject: "eve-gh", email: "eve@example.com" });
    expect(linked.success).toBe(true);
    expect(linked.session?.username).toBe("eve@example.com");
    const eve = await store.findByOAuthSubject("github", "eve-gh");
    expect(eve?.username).toBe("eve@example.com");
    expect(eve?.provider).toBe("password"); // no se pisa el provider de la cuenta original
    expect(verifyPassword("Eve-Pass-1!", eve!.passwordHash)).toBe(true); // la password sigue siendo la suya
    store.close();
  });
});
