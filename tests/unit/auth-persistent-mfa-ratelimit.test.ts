// Challenges MFA persistentes y rate limit de password-reset/request.
// Dos conexiones SQLite distintas sobre el mismo archivo simulan dos isolates
// de Cloudflare (o un reinicio del self-host): lo que escribe una tiene que
// verlo la otra.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService, MFA_MAX_ATTEMPTS } from "../../packages/auth/src/auth-service.ts";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store.ts";
import { InMemorySessionStore } from "../../packages/auth/src/session-store.ts";
import { InMemoryRateLimitStore } from "../../packages/auth/src/ephemeral-auth-store.ts";
import {
  SqliteMfaChallengeStore,
  SqliteRateLimitStore,
} from "../../packages/auth/src/stores/sqlite-ephemeral-auth-store.ts";
import {
  allowPasswordResetRequest,
  clientIpFromHeaders,
  RESET_LIMIT_PER_IP,
  RESET_LIMIT_PER_USER,
  RESET_WINDOW_MS,
} from "../../packages/auth/src/password-reset-rate-limit.ts";

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-auth-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "auth.db");
}

async function twoMfaStores() {
  const path = tempDbPath();
  const a = await SqliteMfaChallengeStore.open(path);
  const b = await SqliteMfaChallengeStore.open(path);
  cleanups.unshift(() => {
    a.close();
    b.close();
  });
  return { a, b };
}

describe("Challenges MFA persistentes", () => {
  it("un challenge emitido por una instancia se valida y cuenta fallos en otra", async () => {
    const users = new InMemoryUsersStore();
    await users.createUser("ana", "hunter2hunter2", "admin");
    await users.setTotpSecret("ana", TOTP_SECRET);
    const sessions = new InMemorySessionStore();
    const { a, b } = await twoMfaStores();
    const authA = new AuthService(users, sessions, undefined, undefined, a);
    const authB = new AuthService(users, sessions, undefined, undefined, b);

    const login = await authA.login("ana", "hunter2hunter2");
    expect(login.mfaRequired).toBe(true);
    const token = login.mfaChallengeToken!;

    for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
      const auth = i % 2 === 0 ? authA : authB;
      expect((await auth.completeMfaLogin(token, "no-es-un-codigo")).error).toBe("Código de verificación incorrecto.");
    }
    expect((await authB.completeMfaLogin(token, "no-es-un-codigo")).error).toBe(
      "Demasiados códigos incorrectos. Inicia sesión de nuevo."
    );
    expect((await authA.completeMfaLogin(token, "no-es-un-codigo")).error).toBe(
      "El código de verificación expiró. Inicia sesión de nuevo."
    );
  });

  it("un challenge vencido no se devuelve", async () => {
    const { a, b } = await twoMfaStores();
    await a.create("vencido", { username: "ana", role: "admin", expiresAt: Date.now() - 1 });
    expect(await b.get("vencido", Date.now())).toBeNull();
    expect(await b.recordFailure("vencido", Date.now())).toBeNull();
    expect(await b.consume("vencido", Date.now(), MFA_MAX_ATTEMPTS)).toBeNull();
  });

  it("consume() solo funciona una vez, aunque se llame desde dos instancias", async () => {
    const { a, b } = await twoMfaStores();
    await a.create("unico", { username: "ana", role: "admin", expiresAt: Date.now() + 60_000 });
    expect(await a.consume("unico", Date.now(), MFA_MAX_ATTEMPTS)).toMatchObject({ username: "ana", role: "admin" });
    expect(await b.consume("unico", Date.now(), MFA_MAX_ATTEMPTS)).toBeNull();
  });

  it("consume() rechaza un challenge que ya agoto los intentos", async () => {
    const { a } = await twoMfaStores();
    await a.create("agotado", { username: "ana", role: "admin", expiresAt: Date.now() + 60_000 });
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) await a.recordFailure("agotado", Date.now());
    expect(await a.consume("agotado", Date.now(), MFA_MAX_ATTEMPTS)).toBeNull();
  });
});

describe("Rate limit de /admin/password-reset/request", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);

  it(`permite ${RESET_LIMIT_PER_USER} pedidos por usuario por hora, sin importar mayusculas ni la IP`, async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RESET_LIMIT_PER_USER; i++) {
      expect(await allowPasswordResetRequest(store, `198.51.100.${i}`, i % 2 ? "Ana" : " ana ", now)).toBe(true);
    }
    expect(await allowPasswordResetRequest(store, "198.51.100.99", "ANA", now)).toBe(false);
    expect(await allowPasswordResetRequest(store, "198.51.100.99", "bruno", now)).toBe(true);
  });

  it(`permite ${RESET_LIMIT_PER_IP} pedidos por IP por hora`, async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RESET_LIMIT_PER_IP; i++) {
      expect(await allowPasswordResetRequest(store, "203.0.113.7", `usuario-${i}`, now)).toBe(true);
    }
    expect(await allowPasswordResetRequest(store, "203.0.113.7", "otro", now)).toBe(false);
    expect(await allowPasswordResetRequest(store, "203.0.113.8", "otro", now)).toBe(true);
  });

  it("la ventana siguiente vuelve a permitir pedidos", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RESET_LIMIT_PER_USER; i++) await allowPasswordResetRequest(store, "192.0.2.1", "ana", now);
    expect(await allowPasswordResetRequest(store, "192.0.2.1", "ana", now)).toBe(false);
    expect(await allowPasswordResetRequest(store, "192.0.2.1", "ana", now + RESET_WINDOW_MS)).toBe(true);
  });

  it("el limite se comparte entre dos conexiones SQLite", async () => {
    const path = tempDbPath();
    const a = await SqliteRateLimitStore.open(path);
    const b = await SqliteRateLimitStore.open(path);
    cleanups.unshift(() => {
      a.close();
      b.close();
    });
    for (let i = 0; i < RESET_LIMIT_PER_USER; i++) {
      expect(await allowPasswordResetRequest(i % 2 ? a : b, `192.0.2.${i}`, "ana", now)).toBe(true);
    }
    expect(await allowPasswordResetRequest(a, "192.0.2.50", "ana", now)).toBe(false);
  });

  it("clientIpFromHeaders prioriza CF-Connecting-IP y despues el primer X-Forwarded-For", () => {
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
