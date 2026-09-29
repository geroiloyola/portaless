// Endpoints v0.0.9.30: rotacion de did:apw con verificacion reforzada,
// cambio de contrasena e historial. Los factories de stores se reemplazan
// por instancias compartidas en memoria (los reales crean una instancia
// nueva por request sin DB, y el estado se perderia entre llamadas).
// Claves Ed25519 y cifrado AES-GCM reales. password.ts y totp.ts con
// dobles deterministas, igual que auth-step-up.test.ts.
import { describe, it, expect, vi } from "vitest";

const shared = vi.hoisted(() => {
  const users = new Map<string, { username: string; role: string; passwordHash?: string; totpSecret: string | null }>([
    ["admin", { username: "admin", role: "admin", passwordHash: "hash:correcta", totpSecret: null }],
    ["admin2fa", { username: "admin2fa", role: "admin", passwordHash: "hash:correcta", totpSecret: "S" }],
  ]);
  return { users };
});

vi.mock("../../packages/auth/src/password", () => ({
  verifyPassword: (plain: string, hash: string) => hash === `hash:${plain}`,
}));
vi.mock("../../packages/auth/src/totp", () => ({
  verifyTotpCode: (_s: string, code: string) => code === "123456",
  generateTotpSecret: () => "SECRET",
  buildTotpUri: () => "otpauth://totp/test",
}));
vi.mock("../../packages/auth/src/store-factory", async () => {
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const sessions = new InMemorySessionStore();
  const usersStore = {
    findByUsername: async (u: string) => shared.users.get(u) ?? null,
    setPasswordByUsername: async (u: string, p: string) => {
      const user = shared.users.get(u);
      if (user) user.passwordHash = `hash:${p}`;
    },
  };
  const resets = { invalidateAllForUser: async () => {}, consume: async () => null, create: async () => ({ token: "x" }) };
  return {
    createUsersStore: async () => usersStore,
    createSessionStore: async () => sessions,
    createPasswordResetStore: async () => resets,
  };
});
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async () => {
  const { InMemorySiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/site-identity-store");
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
  const store = new InMemorySiteIdentityStore({ PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: key });
  return { createSiteIdentityStore: async () => store };
});

import * as siteIdentity from "../../functions/admin/api/site-identity.js";
import * as changePassword from "../../functions/admin/api/change-password.js";
import * as passwordEvents from "../../functions/admin/api/password-events.js";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://sitio.test/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(request: Request, username: string | null, role = "admin") {
  return { request, env: {}, data: username ? { user: { username, role } } : {} } as never;
}

describe("POST /admin/api/site-identity con rotate", () => {
  it("crea la identidad y exige verificacion reforzada para rotarla", async () => {
    const created = await siteIdentity.onRequestPost(ctx(post({ domain: "ejemplo.com" }), "admin"));
    expect(created.status).toBe(201);
    const first = await created.json();

    const noConfirm = await siteIdentity.onRequestPost(ctx(post({ rotate: true, password: "correcta" }), "admin"));
    expect(noConfirm.status).toBe(400);

    const noPassword = await siteIdentity.onRequestPost(ctx(post({ rotate: true, confirm: "ROTAR" }), "admin"));
    expect(noPassword.status).toBe(401);
    expect((await noPassword.json()).reason).toBe("password_required");

    const wrong = await siteIdentity.onRequestPost(ctx(post({ rotate: true, confirm: "ROTAR", password: "mala" }), "admin"));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).reason).toBe("invalid_password");

    const ok = await siteIdentity.onRequestPost(ctx(post({ rotate: true, confirm: "ROTAR", password: "correcta" }), "admin"));
    expect(ok.status).toBe(200);
    const rotated = await ok.json();
    expect(rotated.previousDid).toBe(first.identity.did);
    expect(rotated.identity.publicKeyJwk).not.toEqual(first.identity.publicKeyJwk);
    expect(rotated.privateKeyJwk).toBeTruthy();
  });

  it("con 2FA activo, la contrasena sola no alcanza", async () => {
    const onlyPass = await siteIdentity.onRequestPost(ctx(post({ rotate: true, confirm: "ROTAR", password: "correcta" }), "admin2fa"));
    expect(onlyPass.status).toBe(401);
    expect((await onlyPass.json()).reason).toBe("totp_required");

    const ok = await siteIdentity.onRequestPost(
      ctx(post({ rotate: true, confirm: "ROTAR", password: "correcta", totpCode: "123456" }), "admin2fa")
    );
    expect(ok.status).toBe(200);
  });

  it("un viewer no puede rotar aunque tenga la contrasena", async () => {
    const res = await siteIdentity.onRequestPost(ctx(post({ rotate: true, confirm: "ROTAR", password: "correcta" }), "admin", "viewer"));
    expect(res.status).toBe(403);
  });
});

describe("change-password + password-events", () => {
  it("sin sesion responde 401", async () => {
    expect((await changePassword.onRequestPost(ctx(post({}), null))).status).toBe(401);
    expect((await passwordEvents.onRequestGet(ctx(new Request("https://sitio.test/x"), null))).status).toBe(401);
  });

  it("rechaza contrasena nueva corta o actual incorrecta", async () => {
    const short = await changePassword.onRequestPost(ctx(post({ currentPassword: "correcta", newPassword: "corta" }), "admin"));
    expect(short.status).toBe(400);
    const wrong = await changePassword.onRequestPost(ctx(post({ currentPassword: "mala", newPassword: "nueva-segura" }), "admin"));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe("invalid_password");
  });

  it("cambia la contrasena y el historial muestra IP y pais, nunca la contrasena", async () => {
    const res = await changePassword.onRequestPost(
      ctx(post({ currentPassword: "correcta", newPassword: "nueva-segura" }, { "CF-Connecting-IP": "203.0.113.77", "CF-IPCountry": "AR" }), "admin")
    );
    expect(res.status).toBe(200);
    expect(shared.users.get("admin")?.passwordHash).toBe("hash:nueva-segura");

    const history = await passwordEvents.onRequestGet(ctx(new Request("https://sitio.test/x"), "admin"));
    const { events } = await history.json();
    expect(events[0]).toMatchObject({ kind: "change", ip: "203.0.113.77", country: "AR" });
    expect(JSON.stringify(events)).not.toContain("nueva-segura");
  });
});
