import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";
import { SqliteSessionStore } from "../../packages/auth/src/stores/sqlite-session-store";
import { D1SessionStore } from "../../packages/auth/src/stores/d1-session-store";
import { hashOpaqueToken } from "../../packages/auth/src/token-hash";

function d1Like(db: Database.Database) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: stmt.run(...(args as never[])).changes } }),
            first: async () => (stmt.reader ? stmt.get(...(args as never[])) : null) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

describe("A-08 session tokens at rest", () => {
  it("InMemory guarda el hash, no el token usable", async () => {
    const store = new InMemorySessionStore();
    const created = await store.create("admin", "admin", { mfaVerified: true });
    const stored = await store.get(created.token);
    expect(stored?.token).toBe(hashOpaqueToken(created.token));
    expect(stored?.token).not.toBe(created.token);
    expect(stored?.mfaVerified).toBe(true);
  });

  it("SQLite guarda SHA-256(token) y persiste mfa_verified", async () => {
    const db = new Database(":memory:");
    const store = new SqliteSessionStore(db);
    const created = await store.create("admin", "admin", { mfaVerified: true });
    const row = db.prepare("SELECT token, mfa_verified FROM sessions").get() as { token: string; mfa_verified: number };
    expect(row.token).toBe(hashOpaqueToken(created.token));
    expect(row.token).not.toBe(created.token);
    expect(row.mfa_verified).toBe(1);
    expect((await store.get(created.token))?.mfaVerified).toBe(true);
    await store.destroy(created.token);
    expect(await store.get(created.token)).toBeNull();
    db.close();
  });

  it("D1 guarda SHA-256(token) y persiste mfa_verified", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, mfa_verified INTEGER NOT NULL DEFAULT 0)");
    const store = new D1SessionStore(d1Like(db) as never);
    const created = await store.create("admin", "admin", { mfaVerified: true });
    const row = db.prepare("SELECT token, mfa_verified FROM sessions").get() as { token: string; mfa_verified: number };
    expect(row.token).toBe(hashOpaqueToken(created.token));
    expect(row.mfa_verified).toBe(1);
    expect((await store.get(created.token))?.mfaVerified).toBe(true);
    await store.destroy(created.token);
    expect(await store.get(created.token)).toBeNull();
    db.close();
  });
});
