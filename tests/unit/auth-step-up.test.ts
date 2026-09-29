// AuthService v0.0.9.30: verifyStepUp, changePassword, historial y cierre
// de sesiones. password.ts y totp.ts se reemplazan con dobles
// deterministas (hash:<pw>, codigo 123456) para probar la LOGICA de
// AuthService sin depender del formato real del hash ni del reloj TOTP.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/auth/src/password", () => ({
  verifyPassword: (plain: string, hash: string) => hash === `hash:${plain}`,
}));
vi.mock("../../packages/auth/src/totp", () => ({
  verifyTotpCode: (_secret: string, code: string) => code === "123456",
  generateTotpSecret: () => "SECRET",
  buildTotpUri: () => "otpauth://totp/test",
}));

import { AuthService } from "../../packages/auth/src/auth-service";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";
import { InMemoryPasswordEventStore } from "../../packages/auth/src/password-event-store";

type FakeUser = { username: string; role: "admin" | "viewer"; passwordHash?: string; totpSecret?: string | null };

function fakeUsers(list: FakeUser[]) {
  const users = new Map(list.map((u) => [u.username, { totpSecret: null, ...u }]));
  const store = {
    findByUsername: async (u: string) => users.get(u) ?? null,
    setPasswordByUsername: async (u: string, p: string) => {
      const user = users.get(u);
      if (user) user.passwordHash = `hash:${p}`;
    },
  };
  return { users, store: store as never };
}

function fakeResets() {
  const tokens = new Map<string, string>();
  return {
    tokens,
    store: {
      create: async (username: string) => {
        const token = `t-${tokens.size + 1}`;
        tokens.set(token, username);
        return { token, username };
      },
      consume: async (token: string) => {
        const username = tokens.get(token);
        tokens.delete(token);
        return username ? { token, username } : null;
      },
      invalidateAllForUser: async (username: string) => {
        for (const [t, u] of tokens) if (u === username) tokens.delete(t);
      },
    } as never,
  };
}

describe("verifyStepUp", () => {
  const { store } = fakeUsers([
    { username: "solo-pass", role: "admin", passwordHash: "hash:correcta" },
    { username: "con-2fa", role: "admin", passwordHash: "hash:correcta", totpSecret: "S" },
    { username: "oauth", role: "admin" },
  ]);
  const auth = new AuthService(store, new InMemorySessionStore());

  it("exige y valida la contrasena", async () => {
    expect(await auth.verifyStepUp("solo-pass", {})).toEqual({ ok: false, reason: "password_required" });
    expect(await auth.verifyStepUp("solo-pass", { password: "mala" })).toEqual({ ok: false, reason: "invalid_password" });
    expect(await auth.verifyStepUp("solo-pass", { password: "correcta" })).toEqual({ ok: true });
  });

  it("con 2FA activo exige ademas el codigo TOTP", async () => {
    expect(await auth.verifyStepUp("con-2fa", { password: "correcta" })).toEqual({ ok: false, reason: "totp_required" });
    expect(await auth.verifyStepUp("con-2fa", { password: "correcta", totpCode: "000000" })).toEqual({ ok: false, reason: "invalid_totp" });
    expect(await auth.verifyStepUp("con-2fa", { password: "mala", totpCode: "123456" })).toEqual({ ok: false, reason: "invalid_password" });
    expect(await auth.verifyStepUp("con-2fa", { password: "correcta", totpCode: "123456" })).toEqual({ ok: true });
  });

  it("un usuario sin contrasena ni 2FA no puede pasar", async () => {
    expect(await auth.verifyStepUp("oauth", { password: "x" })).toEqual({ ok: false, reason: "no_step_up_factor" });
    expect(await auth.verifyStepUp("nadie", {})).toEqual({ ok: false, reason: "user_not_found" });
  });
});

describe("changePassword", () => {
  it("cambia la contrasena, cierra todas las sesiones y registra el evento con IP", async () => {
    const { users, store } = fakeUsers([{ username: "admin", role: "admin", passwordHash: "hash:vieja" }]);
    const sessions = new InMemorySessionStore();
    const events = new InMemoryPasswordEventStore();
    const auth = new AuthService(store, sessions, undefined, events);
    const s1 = await sessions.create("admin", "admin");
    const s2 = await sessions.create("admin", "admin");

    const result = await auth.changePassword("admin", "vieja", "nueva-segura", undefined, { ip: "203.0.113.5", country: "AR" });

    expect(result).toEqual({ success: true });
    expect(users.get("admin")?.passwordHash).toBe("hash:nueva-segura");
    expect(await sessions.get(s1.token)).toBeNull();
    expect(await sessions.get(s2.token)).toBeNull();
    const [event] = await events.listForUser("admin");
    expect(event).toMatchObject({ kind: "change", ip: "203.0.113.5", country: "AR" });
    expect(JSON.stringify(event)).not.toContain("nueva-segura");
  });

  it("con la contrasena actual incorrecta no cambia nada", async () => {
    const { users, store } = fakeUsers([{ username: "admin", role: "admin", passwordHash: "hash:vieja" }]);
    const sessions = new InMemorySessionStore();
    const events = new InMemoryPasswordEventStore();
    const auth = new AuthService(store, sessions, undefined, events);
    const s1 = await sessions.create("admin", "admin");

    expect(await auth.changePassword("admin", "mala", "nueva-segura")).toEqual({ success: false, error: "invalid_password" });
    expect(users.get("admin")?.passwordHash).toBe("hash:vieja");
    expect(await sessions.get(s1.token)).not.toBeNull();
    expect(await events.listForUser("admin")).toHaveLength(0);
  });
});

describe("completePasswordReset", () => {
  it("registra el reset y cierra las sesiones", async () => {
    const { store } = fakeUsers([{ username: "admin", role: "admin", passwordHash: "hash:vieja" }]);
    const resets = fakeResets();
    const sessions = new InMemorySessionStore();
    const events = new InMemoryPasswordEventStore();
    const auth = new AuthService(store, sessions, resets.store, events);
    const s1 = await sessions.create("admin", "admin");
    const { token } = (await auth.requestPasswordReset("admin"))!;

    expect(await auth.completePasswordReset(token, "nueva-segura", { ip: "198.51.100.7" })).toEqual({ success: true });
    expect(await sessions.get(s1.token)).toBeNull();
    expect((await events.listForUser("admin"))[0]).toMatchObject({ kind: "reset", ip: "198.51.100.7" });
  });
});

describe("InMemorySessionStore.destroyAllForUser", () => {
  it("cierra solo las sesiones de ese usuario", async () => {
    const sessions = new InMemorySessionStore();
    const a = await sessions.create("admin", "admin");
    const b = await sessions.create("otro", "viewer");
    expect(await sessions.destroyAllForUser("admin")).toBe(1);
    expect(await sessions.get(a.token)).toBeNull();
    expect(await sessions.get(b.token)).not.toBeNull();
  });
});
