// destroyAllForUser() en los 3 backends de sesiones. SQLite real
// (better-sqlite3 :memory:). D1 se prueba con un adaptador D1-compatible
// sobre el mismo better-sqlite3: ejecuta el SQL real del D1SessionStore
// y devuelve meta.changes como D1.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { InMemorySessionStore, type SessionStore } from "../../packages/auth/src/session-store";
import { SqliteSessionStore } from "../../packages/auth/src/stores/sqlite-session-store";
import { D1SessionStore } from "../../packages/auth/src/stores/d1-session-store";

function d1Like() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)");
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

const backends: [string, () => SessionStore][] = [
  ["InMemory", () => new InMemorySessionStore()],
  ["SQLite", () => new SqliteSessionStore(new Database(":memory:"))],
  ["D1", () => new D1SessionStore(d1Like() as never)],
];

for (const [name, make] of backends) {
  describe(`destroyAllForUser -- ${name}`, () => {
    it("cierra todas las sesiones del usuario y deja intactas las de otros", async () => {
      const store = make();
      const a1 = await store.create("admin", "admin");
      const a2 = await store.create("admin", "admin");
      const other = await store.create("otro", "viewer");

      expect(await store.destroyAllForUser!("admin")).toBe(2);
      expect(await store.get(a1.token)).toBeNull();
      expect(await store.get(a2.token)).toBeNull();
      expect(await store.get(other.token)).not.toBeNull();
      expect(await store.destroyAllForUser!("nadie")).toBe(0);
    });
  });
}
