// Historial de cambios de contrasena: InMemory y SQLite real
// (better-sqlite3 :memory:), mas la extraccion de contexto del Request.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  InMemoryPasswordEventStore,
  SqlitePasswordEventStore,
  passwordEventContextFromRequest,
  type PasswordEventStore,
} from "../../packages/auth/src/password-event-store";

const backends: [string, () => PasswordEventStore][] = [
  ["InMemory", () => new InMemoryPasswordEventStore()],
  ["SQLite", () => new SqlitePasswordEventStore(new Database(":memory:"))],
];

for (const [name, make] of backends) {
  describe(`PasswordEventStore -- ${name}`, () => {
    it("guarda hora, IP y ubicacion, nunca la contrasena, y lista lo mas reciente primero", async () => {
      const store = make();
      await store.record({ username: "admin", kind: "reset", occurredAt: "2026-09-01T10:00:00.000Z", ip: "203.0.113.5", country: "AR", city: "Cordoba" });
      await store.record({ username: "admin", kind: "change", occurredAt: "2026-09-02T10:00:00.000Z", ip: "198.51.100.7" });
      await store.record({ username: "otro", kind: "change", occurredAt: "2026-09-03T10:00:00.000Z" });

      const events = await store.listForUser("admin");
      expect(events.map((e) => e.kind)).toEqual(["change", "reset"]);
      expect(events[1]).toMatchObject({ ip: "203.0.113.5", country: "AR", city: "Cordoba" });
      expect(Object.keys(events[0])).not.toContain("password");
      expect(await store.listForUser("admin", 1)).toHaveLength(1);
    });
  });
}

describe("passwordEventContextFromRequest", () => {
  it("prefiere CF-Connecting-IP y recorta el user agent", () => {
    const req = new Request("https://sitio.test", {
      headers: { "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "10.0.0.1", "User-Agent": "x".repeat(400), "CF-IPCountry": "CL" },
    });
    const ctx = passwordEventContextFromRequest(req);
    expect(ctx.ip).toBe("203.0.113.9");
    expect(ctx.userAgent).toHaveLength(256);
    expect(ctx.country).toBe("CL");
  });

  it("cae a X-Forwarded-For y deja ubicacion null sin Cloudflare", () => {
    const ctx = passwordEventContextFromRequest(new Request("https://sitio.test", { headers: { "X-Forwarded-For": "198.51.100.1, 10.0.0.1" } }));
    expect(ctx).toMatchObject({ ip: "198.51.100.1", country: null, city: null });
  });
});
