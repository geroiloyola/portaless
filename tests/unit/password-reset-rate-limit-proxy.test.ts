// IP confiable para el rate limit de password reset en self-host (ROADMAP:
// "Trustworthy X-Forwarded-For proxy handling for self-host (reset rate
// limit)"). El hueco: clientIpFromHeaders() leia CF-Connecting-IP y el
// primer valor de X-Forwarded-For CRUDO, y en el runtime Node self-host
// cualquier atacante podia rotar el bucket por IP con un X-Forwarded-For
// inventado (el limite por usuario seguia cortando, pero el por IP era
// inutil). Ahora, con env.__PORTALESS_RUNTIME === "node", solo se lee
// x-portaless-client-ip, la IP que calcula server/node-runtime.mjs desde la
// IP del socket + PORTALESS_TRUSTED_PROXIES. Ver packages/auth/src/
// password-reset-rate-limit.ts.
//
// Los tests de integracion arrancan el runtime Node REAL
// (createSelfHostServer) contra el endpoint REAL
// (functions/admin/password-reset/request.js) con SQLite en un archivo
// temporal, PORTALESS_DEV_MODE=1 (el devToken revela si el rate limit dejo
// pasar el pedido) y usuarios sembrados de verdad.

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import {
  clientIpFromHeaders,
  RESET_LIMIT_PER_IP,
} from "../../packages/auth/src/password-reset-rate-limit";
import { passwordEventContextFromRequest } from "../../packages/auth/src/password-event-store";
import { createUsersStore } from "../../packages/auth/src/store-factory";
import { applySchema } from "../../scripts/setup.mjs";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

// El schema se aplica UNA vez a una plantilla; cada start() copia el archivo
// (antes, applySchema dentro del test rozaba el timeout de 5s bajo carga).
let TEMPLATE: string;
let templateDir: string;
beforeAll(async () => {
  templateDir = mkdtempSync(join(tmpdir(), "portaless-reset-proxy-template-"));
  TEMPLATE = join(templateDir, "template.db");
  await applySchema(TEMPLATE, { quiet: true });
});
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

describe("clientIpFromHeaders -- runtime Node vs Cloudflare", () => {
  it("en self-host Node lee solo x-portaless-client-ip e ignora los headers falsificables", () => {
    const headers = new Headers({
      "x-portaless-client-ip": "203.0.113.9",
      "cf-connecting-ip": "6.6.6.6",
      "x-forwarded-for": "6.6.6.6, 1.2.3.4",
    });
    expect(clientIpFromHeaders(headers, { __PORTALESS_RUNTIME: "node" })).toBe("203.0.113.9");
  });

  it("en self-host Node sin el header interno cae a 'unknown' (bucket unico, no rotable)", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "6.6.6.6" });
    expect(clientIpFromHeaders(headers, { __PORTALESS_RUNTIME: "node" })).toBe("unknown");
  });

  it("sin env (Cloudflare) mantiene CF-Connecting-IP primero y despues el primer X-Forwarded-For", () => {
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("env sin marcador de runtime se comporta como Cloudflare (backward compatible)", () => {
    const headers = new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" });
    expect(clientIpFromHeaders(headers, {})).toBe("2.2.2.2");
  });
});

describe("passwordEventContextFromRequest -- la auditoria usa la misma IP confiable", () => {
  it("en self-host Node usa el header interno y no la X-Forwarded-For falsificable", () => {
    const request = new Request("https://sitio.test", {
      headers: { "x-portaless-client-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" },
    });
    expect(passwordEventContextFromRequest(request, { __PORTALESS_RUNTIME: "node" }).ip).toBe("203.0.113.9");
  });

  it("en Cloudflare sigue leyendo CF-Connecting-IP y el primer X-Forwarded-For", () => {
    const request = new Request("https://sitio.test", {
      headers: { "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "10.0.0.1, 10.0.0.2" },
    });
    expect(passwordEventContextFromRequest(request).ip).toBe("203.0.113.9");
  });

  it("sin ninguna IP el campo queda null (no 'unknown')", () => {
    expect(passwordEventContextFromRequest(new Request("https://sitio.test")).ip).toBeNull();
  });
});

describe("endpoint real /admin/password-reset/request tras el runtime Node", () => {
  async function start(envOverrides: Record<string, string>, userCount: number) {
    const dir = mkdtempSync(join(tmpdir(), "portaless-reset-proxy-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, "portaless-test.db");
    mkdirSync(join(dir, "dist"), { recursive: true });
    const env: Record<string, string> = {
      PORTALESS_SQLITE_PATH: dbPath,
      PORTALESS_DEV_MODE: "1",
      ...envOverrides,
    };

    copyFileSync(TEMPLATE, dbPath);
    const users = await createUsersStore(env);
    for (let i = 1; i <= userCount; i++) {
      await users.createUser(`reset-proxy-u${i}`, "hunter2hunter2", "editor");
    }

    const server = await createSelfHostServer({
      rootDir: process.cwd(),
      functionsDir: join(process.cwd(), "functions"),
      staticDir: join(dir, "dist"),
      env,
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok());
    });
    cleanup.push(() => server.close());
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    // El runtime lee env en vivo; el origen publico es el puerto efimero real.
    env.PORTALESS_PUBLIC_URL = base;

    async function requestReset(username: string, extraHeaders: Record<string, string> = {}) {
      const res = await fetch(`${base}/admin/password-reset/request`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base, ...extraHeaders },
        body: JSON.stringify({ username }),
      });
      return (await res.json()) as { success: boolean; devToken?: string };
    }

    return { requestReset };
  }

  it("un X-Forwarded-For inventado NO rota el bucket por IP (usuarios distintos, misma IP de socket)", async () => {
    // 6 usuarios distintos (el limite por usuario no corta) y 6 X-Forwarded-For
    // distintos falsificados. Con la IP del socket (127.0.0.1) compartida, el
    // 6to pedido tiene que caer por el limite por IP (5/h). Si la X-Forwarded-For
    // cruda mandara, cada pedido tendria su propio bucket y los 6 pasarian.
    const { requestReset } = await start({}, RESET_LIMIT_PER_IP + 1);

    const results = [];
    for (let i = 1; i <= RESET_LIMIT_PER_IP + 1; i++) {
      results.push(await requestReset(`reset-proxy-u${i}`, { "X-Forwarded-For": `203.0.113.${i}` }));
    }

    for (let i = 0; i < RESET_LIMIT_PER_IP; i++) {
      expect(results[i].devToken, `pedido ${i + 1} deberia pasar`).toBeTruthy();
    }
    expect(results[RESET_LIMIT_PER_IP].devToken, "el 6to debe estar limitado por IP").toBeUndefined();
  });

  it("con el proxy configurado como confiable, el limite por IP sigue la cadena X-Forwarded-For", async () => {
    // 127.0.0.1 es el proxy confiable: la IP del cliente real es la primera no
    // confiable de la cadena. Detras del proxy, .7 agota su bucket y .8 sigue
    // teniendo el suyo propio.
    const { requestReset } = await start({ PORTALESS_TRUSTED_PROXIES: "127.0.0.1" }, RESET_LIMIT_PER_IP + 2);

    for (let i = 1; i <= RESET_LIMIT_PER_IP; i++) {
      const res = await requestReset(`reset-proxy-u${i}`, { "X-Forwarded-For": "198.51.100.7" });
      expect(res.devToken, `pedido ${i} de .7 deberia pasar`).toBeTruthy();
    }
    const blocked = await requestReset(`reset-proxy-u${RESET_LIMIT_PER_IP + 1}`, { "X-Forwarded-For": "198.51.100.7" });
    expect(blocked.devToken, ".7 agoto su bucket tras el proxy").toBeUndefined();

    const other = await requestReset(`reset-proxy-u${RESET_LIMIT_PER_IP + 2}`, { "X-Forwarded-For": "198.51.100.8" });
    expect(other.devToken, ".8 tras el mismo proxy tiene bucket propio").toBeTruthy();
  });
});
