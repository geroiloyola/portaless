import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirstRunService, SETUP_TTL_MS } from "../../server/first-run.mjs";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function fakeUsers() {
  const users = new Map<string, { username: string; role: string }>();
  return {
    users,
    usersStoreFactory: async () => ({
      listUsers: async () => [...users.values()],
      findByUsername: async (u: string) => users.get(u) ?? null,
      close() {},
    }),
    ensureInitialAdmin: async (_s: unknown, username: string) => {
      if (users.size) throw new Error("ya existen usuarios");
      users.set(username, { username, role: "admin" });
    },
  };
}

function make(opts: { env?: Record<string, string>; users?: ReturnType<typeof fakeUsers>; dir?: string; clock?: { t: number } } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "portaless-first-run-"));
  if (!opts.dir) dirs.push(dir);
  const users = opts.users ?? fakeUsers();
  const clock = opts.clock ?? { t: Date.parse("2026-09-30T12:00:00Z") };
  const logs: string[] = [];
  const service = createFirstRunService({
    env: opts.env ?? {}, sqlitePath: join(dir, "portaless.db"), dataDir: dir,
    now: () => clock.t, log: (l: string) => logs.push(l),
    applySchema: async () => {}, usersStoreFactory: users.usersStoreFactory, ensureInitialAdmin: users.ensureInitialAdmin,
  });
  return { dir, users, clock, logs, service };
}
const codeOf = (dir: string) => readFileSync(join(dir, "SETUP_CODE.txt"), "utf-8").trim();
const state = (dir: string) => JSON.parse(readFileSync(join(dir, "portaless-secrets.json"), "utf-8"));
const valid = { username: "admin", password: "una-contrasena-larga" };

describe("first-run service", () => {
  it("genera clave Base64 estandar de 32 bytes y la persiste entre reinicios", async () => {
    const a = make();
    const { envPatch } = await a.service.prepare();
    const key = envPatch.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY;
    expect(Uint8Array.from(atob(key), (c) => c.charCodeAt(0)).length).toBe(32);
    expect(a.service.status()).toEqual({ needsSetup: true, keySourceWarning: true });
    const b = make({ dir: a.dir, users: a.users });
    expect((await b.service.prepare()).envPatch.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY).toBe(key);
  });

  it("no copia al volumen la clave provista por entorno", async () => {
    const a = make({ env: { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: "ZW52LWtleQ==" } });
    await a.service.prepare();
    expect(state(a.dir).siteIdentityEncryptionKey).toBeUndefined();
    expect(readFileSync(join(a.dir, "portaless-secrets.json"), "utf-8")).not.toContain("ZW52LWtleQ==");
    expect(a.service.status().keySourceWarning).toBe(false);
  });

  it("persiste solo el hash del codigo, con TTL e intentos", async () => {
    const a = make();
    await a.service.prepare();
    const code = codeOf(a.dir);
    const s = state(a.dir);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(JSON.stringify(s)).not.toContain(code);
    expect(s.setup.attemptsRemaining).toBe(5);
    expect(Date.parse(s.setup.expiresAt) - a.clock.t).toBe(SETUP_TTL_MS);
  });

  it("usa PORTALESS_SETUP_CODE sin escribirlo a disco", async () => {
    const a = make({ env: { PORTALESS_SETUP_CODE: "abcd-2345" } });
    await a.service.prepare();
    expect(existsSync(join(a.dir, "SETUP_CODE.txt"))).toBe(false);
    expect((await a.service.complete({ code: "ABCD2345", ...valid })).status).toBe(201);
  });

  it("codigo invalido descuenta intentos y agotarlos bloquea incluso el codigo correcto", async () => {
    const a = make();
    await a.service.prepare();
    const code = codeOf(a.dir);
    for (let i = 0; i < 5; i++) expect((await a.service.complete({ code: "XXXXXXXX", ...valid })).status).toBe(403);
    expect(state(a.dir).setup.attemptsRemaining).toBe(0);
    const r = await a.service.complete({ code, ...valid });
    expect(r).toEqual({ status: 403, body: { success: false, error: "invalid_setup_code" } });
    expect(a.users.users.size).toBe(0);
  });

  it("rechaza un codigo vencido con la misma respuesta generica", async () => {
    const a = make();
    await a.service.prepare();
    a.clock.t += SETUP_TTL_MS + 1;
    expect((await a.service.complete({ code: codeOf(a.dir), ...valid })).body.error).toBe("invalid_setup_code");
  });

  it("valida el body sin consumir intentos", async () => {
    const a = make();
    await a.service.prepare();
    expect((await a.service.complete({ code: "x", username: "a", password: "x".repeat(20) })).status).toBe(400);
    expect((await a.service.complete({ code: "x", username: "admin", password: "corta" })).status).toBe(400);
    expect(state(a.dir).setup.attemptsRemaining).toBe(5);
  });

  it("codigo correcto crea el admin, borra SETUP_CODE.txt y bloquea un segundo setup", async () => {
    const a = make();
    await a.service.prepare();
    const code = codeOf(a.dir);
    expect(await a.service.complete({ code, ...valid })).toEqual({ status: 201, body: { success: true, redirect: "/admin/login" } });
    expect(a.users.users.get("admin")?.role).toBe("admin");
    expect(existsSync(join(a.dir, "SETUP_CODE.txt"))).toBe(false);
    expect(state(a.dir).setup).toMatchObject({ consumed: true });
    expect(state(a.dir).setup.codeHash).toBeUndefined();
    expect(a.service.status().needsSetup).toBe(false);
    expect((await a.service.complete({ code, username: "otro", password: valid.password })).status).toBe(410);
  });

  it("serializa requests concurrentes: solo uno crea el admin", async () => {
    const a = make();
    await a.service.prepare();
    const code = codeOf(a.dir);
    const results = await Promise.all([1, 2, 3].map((i) => a.service.complete({ code, username: `admin${i}`, password: valid.password })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(a.users.users.size).toBe(1);
  });

  it("tras reiniciar con usuarios existentes no genera un codigo nuevo", async () => {
    const a = make();
    await a.service.prepare();
    await a.service.complete({ code: codeOf(a.dir), ...valid });
    const b = make({ dir: a.dir, users: a.users });
    expect((await b.service.prepare()).needsSetup).toBe(false);
    expect(existsSync(join(a.dir, "SETUP_CODE.txt"))).toBe(false);
  });
});
