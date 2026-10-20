import { describe, expect, it } from "vitest";
import { isTrustedRequestOrigin } from "../../functions/_shared/request-origin.js";

describe("same-origin request policy", () => {
  it("accepts the exact Origin and same-origin Referer", () => {
    expect(isTrustedRequestOrigin(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example" },
    }), {}, { requireOrigin: true })).toBe(true);
    expect(isTrustedRequestOrigin(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { referer: "https://site.example/admin/settings/email" },
    }), {}, { requireOrigin: true })).toBe(true);
  });

  it("rejects cross-site, opaque and absent browser provenance on protected writes", () => {
    const target = "https://site.example/admin/api/email";
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { origin: "https://attacker.example" } }))).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { origin: "null" } }))).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT", headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isTrustedRequestOrigin(new Request(target, { method: "PUT" }), {}, { requireOrigin: true })).toBe(false);
  });

  it("supports the configured public origin behind an internal proxy URL", () => {
    expect(isTrustedRequestOrigin(new Request("http://127.0.0.1:3000/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example" },
    }), { PORTALESS_PUBLIC_URL: "https://site.example/base/" }, { requireOrigin: true })).toBe(true);
  });
});
