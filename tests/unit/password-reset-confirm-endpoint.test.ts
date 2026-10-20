// POST /admin/password-reset/confirm — 0% de cobertura. Contra SQLite real
// (temp): valida los 400 de contrato (JSON roto, faltan campos, password
// corto), el token invalido, y el ciclo real completo (token creado por
// el store -> confirm cambia la contrasena -> login con la nueva funciona
// y con la vieja falla -> el token queda de un solo uso).

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRequestPost } from "../../functions/admin/password-reset/confirm";
import { createUsersStore, createSessionStore, createPasswordResetStore } from "../../packages/auth/src/store-factory";
import { AuthService } from "../../packages/auth/src/auth-service";

const tmp = mkdtempSync(join(tmpdir(), "portaless-pwd-confirm-"));
const dbPath = join(tmp, "auth.db");
const env = { PORTALESS_SQLITE_PATH: dbPath };

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(body: unknown, raw = false) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://x.test" };
  const init: RequestInit = { method: "POST", headers };
  if (raw) init.body = String(body);
  else init.body = JSON.stringify(body);
  return { request: new Request("http://x.test/admin/password-reset/confirm", init), env } as any;
}

describe("admin/password-reset/confirm.js", () => {
  it("400: JSON roto, faltan campos o password menor a 12 caracteres", async () => {
    const broken = await onRequestPost(ctx("{not-json", true));
    expect(broken.status).toBe(400);

    const missing = await onRequestPost(ctx({ token: "t" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("Faltan");

    const short = await onRequestPost(ctx({ token: "t", newPassword: "corto" }));
    expect(short.status).toBe(400);
    expect((await short.json()).error).toContain("12");
  });

  it("400: token inexistente o ya usado", async () => {
    const res = await onRequestPost(ctx({ token: "token-fantasma", newPassword: "nueva-password-larga" }));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it("ciclo real: token del store -> confirm -> login con la nueva password, no con la vieja; token de un solo uso", async () => {
    const users = await createUsersStore(env);
    const resets = await createPasswordResetStore(env);
    await users.createUser("admin-reset", "password-vieja-larga", "admin");
    const record = await resets.create("admin-reset");

    const ok = await onRequestPost(ctx({ token: record.token, newPassword: "password-nueva-larga" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).success).toBe(true);

    const auth = new AuthService(users, await createSessionStore(env), resets);
    const loginNuevo = await auth.login("admin-reset", "password-nueva-larga");
    expect(loginNuevo.success).toBe(true);
    const loginVieja = await auth.login("admin-reset", "password-vieja-larga");
    expect(loginVieja.success).toBe(false);

    const replay = await onRequestPost(ctx({ token: record.token, newPassword: "otra-password-larga" }));
    expect(replay.status).toBe(400);
  });
});
