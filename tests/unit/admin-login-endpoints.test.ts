// functions/admin/login.js y functions/admin/login-mfa.js: los dos pasos
// del login real. Estaban a 0% de cobertura (los tests de seguridad
// cubrian los endpoints de cambio de contrasena, no el login). Se ejercitan
// con AuthService y stores reales en memoria (password scrypt y TOTP RFC
// 6238 de verdad; el codigo TOTP se calcula con el mismo algoritmo que
// totp.ts), no con dobles: el objetivo es cubrir el cableado real del
// endpoint (form parsing, redirects, flags de cookie, handoff del
// challenge MFA entre los dos archivos).

import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("../../packages/auth/src/store-factory", async () => {
  const { InMemoryUsersStore } = await import("../../packages/auth/src/users-store");
  const { InMemorySessionStore } = await import("../../packages/auth/src/session-store");
  const { InMemoryRateLimitStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  const { sharedInMemoryMfaChallengeStore } = await import("../../packages/auth/src/ephemeral-auth-store");
  const users = new InMemoryUsersStore();
  const sessions = new InMemorySessionStore();
  const rateLimits = new InMemoryRateLimitStore();
  return {
    createUsersStore: async () => users,
    createSessionStore: async () => sessions,
    createMfaChallengeStore: async () => sharedInMemoryMfaChallengeStore,
    createRateLimitStore: async () => rateLimits,
    createPasswordResetStore: async () => ({ invalidateAllForUser: async () => {}, create: async () => ({ token: "x" }), consume: async () => null }),
  };
});

import * as login from "../../functions/admin/login";
import * as loginMfa from "../../functions/admin/login-mfa";

/** Codigo TOTP valido ahora (misma RFC 6238 que packages/auth/src/totp.ts). */
function currentTotpCode(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const key = Buffer.from(
    normalized.split("").flatMap((ch) => {
      value = (value << 5) | alphabet.indexOf(ch);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        return [(value >> bits) & 0xff];
      }
      return [];
    })
  );
  const counter = Math.floor(now / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** 6).padStart(6, "0");
}

async function seedUsers() {
  const users = await (await import("../../packages/auth/src/store-factory")).createUsersStore({});
  if (!(await users.findByUsername("admin"))) {
    await users.createUser("admin", "Admin-Pass-1!", "admin");
  }
  if (!(await users.findByUsername("carol"))) {
    await users.createUser("carol", "Carol-Pass-1!", "viewer");
    await users.setTotpSecret("carol", "CAROLSECRETTOTP2A");
  }
}

function formRequest(url: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(url).origin },
    body,
  });
}

function context(request: Request, next = async () => new Response("static")) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !request.headers.has("origin")) {
    const headers = new Headers(request.headers);
    headers.set("origin", new URL(request.url).origin);
    request = new Request(request, { headers });
  }
  return {
    request,
    env: { PORTALESS_PUBLIC_URL: new URL(request.url).origin },
    data: {},
    params: {},
    next,
  } as any;
}

describe("functions/admin/login.js", () => {
  it("GET deja pasar al siguiente (pagina estatica)", async () => {
    await seedUsers();
    const next = vi.fn(async () => new Response("login.html"));
    const res = await login.onRequestGet(context(new Request("http://x.test/admin/login"), next));
    expect(await res!.text()).toBe("login.html");
    expect(next).toHaveBeenCalled();
  });

  it("POST sin credenciales redirige a /admin/login?error=1", async () => {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("http://x.test/admin/login", { username: "", password: "" }))
    );
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("http://x.test/admin/login?error=1");
  });

  it("rechaza login publicado desde otro origen", async () => {
    const request = formRequest("https://x.test/admin/login", { username: "admin", password: "guess" });
    const headers = new Headers(request.headers);
    headers.set("origin", "https://attacker.example");
    const response = await login.onRequestPost(context(new Request(request, { headers })));
    expect(response!.status).toBe(403);
    expect(response!.headers.get("cache-control")).toBe("no-store");
  });

  it("rechaza cuerpos de login que exceden el límite antes de parsearlos", async () => {
    const request = new Request("http://x.test/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://x.test" },
      body: `username=admin&password=${"x".repeat(17 * 1024)}`,
    });
    const res = await login.onRequestPost(context(request));
    expect(res!.headers.get("location")).toBe("http://x.test/admin/login?error=1");
  });

  it("POST con password incorrecta redirige a /admin/login?error=1", async () => {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("http://x.test/admin/login", { username: "admin", password: "mala" }))
    );
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("http://x.test/admin/login?error=1");
  });

  it("POST correcto redirige a /admin/ con cookie de sesion (sin Secure en http)", async () => {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("http://x.test/admin/login", { username: "admin", password: "Admin-Pass-1!" }))
    );
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("http://x.test/admin/");
    const cookie = res!.headers.get("set-cookie")!;
    expect(cookie).toContain("portaless_session=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie).not.toContain("Secure");
  });

  it("sobre https la cookie lleva Secure", async () => {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("https://x.test/admin/login", { username: "admin", password: "Admin-Pass-1!" }))
    );
    expect(res!.headers.get("set-cookie")).toContain("Secure");
  });

  it("A-01: no bloquea una contraseña correcta tras 10 fallos de terceros", async () => {
    const users = await (await import("../../packages/auth/src/store-factory")).createUsersStore({});
    await users.createUser("login-bruteforce", "Correct-Password-123!", "admin");
    for (let i = 0; i < 10; i++) {
      const res = await login.onRequestPost(context(formRequest("http://x.test/admin/login", {
        username: "login-bruteforce",
        password: "wrong-password",
      })));
      expect(res!.headers.get("location")).toBe("http://x.test/admin/login?error=1");
    }
    const correct = await login.onRequestPost(context(formRequest("http://x.test/admin/login", {
      username: "login-bruteforce",
      password: "Correct-Password-123!",
    })));
    expect(correct!.status).toBe(302);
    expect(correct!.headers.get("location")).toBe("http://x.test/admin/");
    expect(correct!.headers.get("set-cookie")).toContain("portaless_session=");
  });

  it("usuario con 2FA: redirige a /admin/login-mfa con el challenge", async () => {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("http://x.test/admin/login", { username: "carol", password: "Carol-Pass-1!" }))
    );
    expect(res!.status).toBe(302);
    const location = res!.headers.get("location")!;
    expect(location).toContain("http://x.test/admin/login-mfa?challenge=");
    const challenge = new URL(location).searchParams.get("challenge");
    expect(challenge).toBeTruthy();
  });
});

describe("functions/admin/login-mfa.js", () => {
  it("rechaza completar MFA desde un origen distinto", async () => {
    const request = new Request("https://x.test/admin/login-mfa", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: "synthetic", code: "000000" }),
    });
    const response = await loginMfa.onRequestPost(context(request));
    expect(response!.status).toBe(403);
    expect(response!.headers.get("cache-control")).toBe("no-store");
  });

  async function challengeForCarol(): Promise<string> {
    await seedUsers();
    const res = await login.onRequestPost(
      context(formRequest("http://x.test/admin/login", { username: "carol", password: "Carol-Pass-1!" }))
    );
    return new URL(res!.headers.get("location")!).searchParams.get("challenge")!;
  }

  it("body que no es JSON valido responde 400", async () => {
    const request = new Request("http://x.test/admin/login-mfa", { method: "POST", body: "no-es-json" });
    const res = await loginMfa.onRequestPost(context(request));
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toContain("inválido");
  });

  it("sin challengeToken o code responde 400", async () => {
    const request = new Request("http://x.test/admin/login-mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: "", code: "" }),
    });
    const res = await loginMfa.onRequestPost(context(request));
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toContain("Faltan");
  });

  it("codigo incorrecto responde 401", async () => {
    const challenge = await challengeForCarol();
    const request = new Request("http://x.test/admin/login-mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: challenge, code: "000000" }),
    });
    const res = await loginMfa.onRequestPost(context(request));
    expect(res!.status).toBe(401);
    expect((await res!.json()).success).toBe(false);
  });

  it("codigo correcto: 200, cookie de sesion y challenge de un solo uso", async () => {
    const challenge = await challengeForCarol();
    const code = currentTotpCode("CAROLSECRETTOTP2A");
    const request = new Request("http://x.test/admin/login-mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: challenge, code }),
    });
    const res = await loginMfa.onRequestPost(context(request));
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ success: true });
    const cookie = res!.headers.get("set-cookie")!;
    expect(cookie).toContain("portaless_session=");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure");

    // Un solo uso: reintentar con el mismo challenge ya consumido falla
    // (request nuevo: el body del anterior ya fue leido).
    const replay = await loginMfa.onRequestPost(
      context(
        new Request("http://x.test/admin/login-mfa", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeToken: challenge, code }),
        })
      )
    );
    expect(replay!.status).toBe(401);
  });

  it("sobre https la cookie del segundo paso lleva Secure", async () => {
    const challenge = await challengeForCarol();
    const request = new Request("https://x.test/admin/login-mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: challenge, code: currentTotpCode("CAROLSECRETTOTP2A") }),
    });
    const res = await loginMfa.onRequestPost(context(request));
    expect(res!.status).toBe(200);
    expect(res!.headers.get("set-cookie")).toContain("Secure");
  });
});
