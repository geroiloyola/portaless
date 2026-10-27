import { describe, expect, it } from "vitest";
import { isTrustedRequestOrigin } from "../../functions/_shared/request-origin.js";

describe("same-origin request policy", () => {
  const env = { PORTALESS_PUBLIC_URL: "https://site.example" };

  it("accepts the exact Origin and same-origin Referer from the configured public URL", () => {
    expect(isTrustedRequestOrigin(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example" },
    }), env, { requireOrigin: true })).toBe(true);
    expect(isTrustedRequestOrigin(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { referer: "https://site.example/admin/settings/email" },
    }), env, { requireOrigin: true })).toBe(true);
  });

  it("rejects cross-site, opaque and absent browser provenance on protected writes", () => {
    const target = "https://site.example/admin/api/email";
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { origin: "https://attacker.example" } }), env)).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { origin: "null" } }), env)).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { "sec-fetch-site": "cross-site" } }), env)).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT" }), env, { requireOrigin: true })).toBe(false);
  });

  it("supports the configured public origin behind an internal proxy URL", () => {
    expect(isTrustedRequestOrigin(new Request("http://127.0.0.1:3000/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example" },
    }), { PORTALESS_PUBLIC_URL: "https://site.example/base/" }, { requireOrigin: true })).toBe(true);
  });

  it("A-02: Host and Origin invented together do not pass", () => {
    expect(isTrustedRequestOrigin(new Request("http://evil.attacker.example/admin/login", {
      method: "POST",
      headers: { host: "evil.attacker.example", origin: "http://evil.attacker.example" },
    }), { PORTALESS_PUBLIC_URL: "https://site.example" }, { requireOrigin: true })).toBe(false);
  });

  it("A-02: without PORTALESS_PUBLIC_URL it fails closed, even for a matching Host/Origin", () => {
    expect(isTrustedRequestOrigin(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example" },
    }), {}, { requireOrigin: true })).toBe(false);
  });
});
