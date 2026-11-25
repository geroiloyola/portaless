// B-01..B-06: Cierre individualizado de los 6 puntos de higiene del lote P2.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCookie,
  sessionCookie,
  clearSessionCookie,
} from "../../functions/_shared/request-security.js";
import {
  InvalidContentLengthError,
  InvalidJsonBodyError,
  readBodyLimited,
  readJsonBodyLimited,
  RequestBodyTooLargeError,
} from "../../functions/_shared/read-body-limited.js";
import * as setupComplete from "../../functions/api/setup/complete.js";
import * as changePassword from "../../functions/admin/api/change-password.js";
import * as siteIdentity from "../../functions/admin/api/site-identity.js";
import * as settlement from "../../functions/admin/settlement/index.js";

describe("B-01: exact cookie parsing without regex injection or substring spoofing", () => {
  it("ignores prefix-spoofed cookie names and regex metacharacters", () => {
    const req = new Request("https://site.example/admin", {
      headers: {
        Cookie: "evil_portaless_session=fake; portaless_session=real-token; a.b=dotval",
      },
    });
    expect(getCookie(req, "portaless_session")).toBe("real-token");
    expect(getCookie(req, "a.*b")).toBeNull();
    expect(getCookie(req, "a.b")).toBe("dotval");
  });

  it("returns null on malformed percent-encoding when decode=true", () => {
    const req = new Request("https://site.example/admin", {
      headers: { Cookie: "portaless_oauth_state_github=%E0%A4%A" },
    });
    expect(getCookie(req, "portaless_oauth_state_github", { decode: true })).toBeNull();
  });
});

describe("B-02: public/_headers completeness for /*, /admin/* and /api/*", () => {
  it("declares security headers globally and Cache-Control: no-store for /admin/* and /api/*", () => {
    const content = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
    expect(content).toContain("/*");
    expect(content).toContain("X-Content-Type-Options: nosniff");
    expect(content).toMatch(/\/admin\/\*\s*\n\s*Cache-Control:\s*no-store/);
    expect(content).toMatch(/\/api\/\*\s*\n\s*Cache-Control:\s*no-store/);
  });
});

describe("B-03: parse-after-size rejects oversized payloads with 413 before JSON.parse", () => {
  it("returns 413 on /api/setup/complete for >8 KiB body", async () => {
    const big = JSON.stringify({ code: "123", username: "a", password: "x".repeat(9 * 1024) });
    const res = await setupComplete.onRequestPost({
      request: new Request("https://site.example/api/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://site.example" },
        body: big,
      }),
      env: {
        PORTALESS_PUBLIC_URL: "https://site.example",
        __PORTALESS_FIRST_RUN: { complete: async () => ({ status: 200, body: { ok: true } }) },
      },
    } as any);
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 413 on change-password, site-identity, and settlement for oversized bodies", async () => {
    const big33k = JSON.stringify({ pad: "a".repeat(33 * 1024) });
    const ctx = {
      env: { PORTALESS_PUBLIC_URL: "https://site.example" },
      data: { user: { username: "admin", role: "admin" } },
    };

    const rPass = await changePassword.onRequestPost({
      ...ctx,
      request: new Request("https://site.example/admin/api/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big33k,
      }),
    } as any);
    expect(rPass.status).toBe(413);
    expect(rPass.headers.get("cache-control")).toBe("no-store");

    const rId = await siteIdentity.onRequestPost({
      ...ctx,
      request: new Request("https://site.example/admin/api/site-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big33k,
      }),
    } as any);
    expect(rId.status).toBe(413);
    expect(rId.headers.get("cache-control")).toBe("no-store");

    const rSet = await settlement.onRequestPost({
      ...ctx,
      request: new Request("https://site.example/admin/settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big33k,
      }),
    } as any);
    expect(rSet.status).toBe(413);
    expect(rSet.headers.get("cache-control")).toBe("no-store");
  });
});

describe("B-04: Cache-Control: no-store on sensitive auth/admin error & unauthenticated responses", () => {
  it("sets Cache-Control: no-store on unauthenticated responses of sensitive endpoints", async () => {
    for (const handler of [
      () => changePassword.onRequestPost({ request: new Request("https://site.example/x", { method: "POST" }), env: {}, data: {} } as any),
      () => siteIdentity.onRequestPost({ request: new Request("https://site.example/x", { method: "POST" }), env: {}, data: {} } as any),
      () => settlement.onRequestPost({ request: new Request("https://site.example/x", { method: "POST" }), env: {}, data: {} } as any),
    ]) {
      const res = await handler();
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("B-05: sessionCookie header-injection guard & consistent clearSessionCookie", () => {
  it("rejects CR/LF/semicolon characters in session cookie tokens", () => {
    const req = new Request("https://site.example/admin/login");
    expect(() => sessionCookie("abc\r\nSet-Cookie: evil=1", req, {})).toThrow();
    expect(() => sessionCookie("abc; Path=/evil", req, {})).toThrow();
  });

  it("clearSessionCookie emits Max-Age=0 with HttpOnly, SameSite=Strict and Secure over HTTPS", () => {
    const httpsReq = new Request("https://site.example/admin/logout");
    const cleared = clearSessionCookie(httpsReq, {});
    expect(cleared).toContain("portaless_session=");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Strict");
    expect(cleared).toContain("Secure");
  });
});

describe("B-06: strict Content-Length validation and JSON object enforcement", () => {
  it("rejects negative or non-numeric Content-Length headers", async () => {
    const negReq = new Request("https://site.example/x", {
      method: "POST",
      headers: { "content-length": "-5" },
      body: "{}",
    });
    await expect(readBodyLimited(negReq, 1024)).rejects.toBeInstanceOf(InvalidContentLengthError);

    const alphaReq = new Request("https://site.example/x", {
      method: "POST",
      headers: { "content-length": "12abc" },
      body: "{}",
    });
    await expect(readBodyLimited(alphaReq, 1024)).rejects.toBeInstanceOf(InvalidContentLengthError);
  });

  it("rejects non-object JSON payloads when requireObject is true, and oversize before parsing", async () => {
    const arrReq = new Request("https://site.example/x", {
      method: "POST",
      body: "[1,2,3]",
    });
    await expect(readJsonBodyLimited(arrReq, 1024, { requireObject: true })).rejects.toBeInstanceOf(InvalidJsonBodyError);

    const bigReq = new Request("https://site.example/x", {
      method: "POST",
      body: "{not-even-valid-json" + "x".repeat(200),
    });
    await expect(readJsonBodyLimited(bigReq, 32, { requireObject: true })).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
