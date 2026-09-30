import { describe, expect, it } from "vitest";
import { AuthService, MFA_MAX_ATTEMPTS } from "../../packages/auth/src/auth-service.ts";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store.ts";

function fakeSessions() {
  let n = 0;
  return {
    create: async (username: string, role: string) => ({ token: `t${++n}`, username, role }),
    get: async () => null,
    destroy: async () => {},
  } as any;
}

async function challenge() {
  const users = new InMemoryUsersStore();
  await users.createUser("admin", "una-contrasena-larga", "admin");
  await users.setTotpSecret("admin", "JBSWY3DPEHPK3PXP");
  const auth = new AuthService(users, fakeSessions());
  const login = await auth.login("admin", "una-contrasena-larga");
  expect(login.mfaRequired).toBe(true);
  return { auth, token: login.mfaChallengeToken as string };
}

describe("limite de intentos MFA", () => {
  it("borra el challenge al llegar al maximo de codigos incorrectos", async () => {
    const { auth, token } = await challenge();
    for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
      expect((await auth.completeMfaLogin(token, "no-es-un-codigo")).error).toBe("Código de verificación incorrecto.");
    }
    expect((await auth.completeMfaLogin(token, "no-es-un-codigo")).error).toBe("Demasiados códigos incorrectos. Inicia sesión de nuevo.");
    expect((await auth.completeMfaLogin(token, "no-es-un-codigo")).error).toBe("El código de verificación expiró. Inicia sesión de nuevo.");
  });

  it("cada login con contrasena emite un challenge nuevo con el contador en cero", async () => {
    const first = await challenge();
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) await first.auth.completeMfaLogin(first.token, "no-es-un-codigo");
    const second = await challenge();
    expect(second.token).not.toBe(first.token);
    expect((await second.auth.completeMfaLogin(second.token, "no-es-un-codigo")).error).toBe("Código de verificación incorrecto.");
  });
});
