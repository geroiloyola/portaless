import { describe, expect, it } from "vitest";
import { scryptSync, randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  passwordNeedsRehash,
  SCRYPT_COST_N,
  LEGACY_SCRYPT_COST_N,
} from "../../packages/auth/src/password";
import { AuthService } from "../../packages/auth/src/auth-service";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";

function legacyHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: LEGACY_SCRYPT_COST_N });
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

describe("password scrypt (A-08)", () => {
  it("usa N=2^17 y el formato con costo explicito", async () => {
    const hash = await hashPassword("Correct-Password-123!");
    expect(hash.startsWith(`scrypt:${SCRYPT_COST_N}:`)).toBe(true);
    await expect(verifyPassword("Correct-Password-123!", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
  });

  it("acepta el formato historico N=2^14 y lo marca para rehash", async () => {
    const hash = legacyHash("Legacy-Password-123!");
    await expect(verifyPassword("Legacy-Password-123!", hash)).resolves.toBe(true);
    expect(passwordNeedsRehash(hash)).toBe(true);
  });

  it("AuthService rehashea un hash legacy en el primer login", async () => {
    const users = new InMemoryUsersStore();
    const auth = new AuthService(users, new InMemorySessionStore());
    const user = await users.createUser("legacy", "Legacy-Password-123!", "admin");
    user.passwordHash = legacyHash("Legacy-Password-123!");

    const result = await auth.login("legacy", "Legacy-Password-123!");
    expect(result.success).toBe(true);
    const updated = await users.findByUsername("legacy");
    expect(updated?.passwordHash.startsWith(`scrypt:${SCRYPT_COST_N}:`)).toBe(true);
    await expect(verifyPassword("Legacy-Password-123!", updated!.passwordHash)).resolves.toBe(true);
  });

  it("M-02: un usuario inexistente no retorna antes de ejecutar scrypt", async () => {
    const auth = new AuthService(new InMemoryUsersStore(), new InMemorySessionStore());
    const started = performance.now();
    const result = await auth.login("no-existe", "wrong-password");
    const elapsed = performance.now() - started;
    expect(result.success).toBe(false);
    expect(elapsed).toBeGreaterThan(5);
  });
});
