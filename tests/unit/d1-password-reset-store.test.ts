// D1PasswordResetStore — persistencia real de tokens de recuperacion sobre
// D1, 0% de cobertura. Mismo patron que d1-site-trust-store.test.ts (fake
// D1DatabaseLike sobre better-sqlite3). Cubre: create devuelve record con
// TTL de 30 min, consume marca used_at y devuelve el record, segundo
// consume (ya usado) devuelve null, token expirado se borra y devuelve
// null, consume inexistente null, invalidateAllForUser limpia todos los
// tokens del usuario sin tocar los de otros.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { D1PasswordResetStore } from "../../packages/auth/src/stores/d1-password-reset-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-d1-pwd-reset-"));
const dbPath = join(tmp, "auth.db");
let db: Database.Database;
let store: D1PasswordResetStore;

function fakeD1(database: any) {
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

beforeAll(() => {
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE password_reset_requests (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
  `);
  store = new D1PasswordResetStore(fakeD1(db));
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("D1PasswordResetStore", () => {
  it("create devuelve record con token hex de 32 bytes y TTL de 30 minutos", async () => {
    const record = await store.create("admin");
    expect(record.username).toBe("admin");
    expect(record.token).toMatch(/^[0-9a-f]{64}$/);
    const ttl = new Date(record.expiresAt).getTime() - new Date(record.createdAt).getTime();
    expect(ttl).toBe(30 * 60 * 1000);
  });

  it("consume es un solo uso: primera vez devuelve el record, segunda null", async () => {
    const record = await store.create("admin");
    const consumed = await store.consume(record.token);
    expect(consumed).not.toBeNull();
    expect(consumed!.username).toBe("admin");
    expect(consumed!.usedAt).toBeTruthy();
    expect(await store.consume(record.token)).toBeNull();
  });

  it("token expirado: consume lo borra y devuelve null", async () => {
    const record = await store.create("admin");
    db.prepare("UPDATE password_reset_requests SET expires_at = ? WHERE token = ?")
      .run(new Date(Date.now() - 1000).toISOString(), record.token);
    expect(await store.consume(record.token)).toBeNull();
    const row = db.prepare("SELECT token FROM password_reset_requests WHERE token = ?").get(record.token);
    expect(row).toBeUndefined();
  });

  it("consume de token inexistente devuelve null", async () => {
    expect(await store.consume("no-existe")).toBeNull();
  });

  it("invalidateAllForUser borra todos los tokens del usuario y deja los demas", async () => {
    const a1 = await store.create("alice");
    const a2 = await store.create("alice");
    const b = await store.create("bob");
    await store.invalidateAllForUser("alice");
    expect(await store.consume(a1.token)).toBeNull();
    expect(await store.consume(a2.token)).toBeNull();
    expect(await store.consume(b.token)).not.toBeNull();
  });
});
