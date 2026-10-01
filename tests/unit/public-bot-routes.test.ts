import { describe, expect, it } from "vitest";
import { isPublicBotRoute } from "../../packages/trust-layer/src/policy/public-bot-routes.ts";

const pathOf = (url: string) => new URL(url, "https://a.com").pathname;

describe("isPublicBotRoute", () => {
  it("deja pasar las rutas de descubrimiento", () => {
    for (const path of [
      "/robots.txt",
      "/llms.txt",
      "/sitemap.xml",
      "/.well-known/portaless-content-policy.json",
      "/.well-known/portaless-usage-log.json",
      "/blog/hola.md",
      "/blog/serie/parte-1.md",
    ]) {
      expect(isPublicBotRoute(path), path).toBe(true);
    }
  });

  it("no deja pasar contenido ni admin", () => {
    for (const path of ["/", "/blog/hola/", "/blog/hola", "/paginas/inicio", "/admin/", "/llms.txt.bak", "/robots.txt/x", "/blog.md"]) {
      expect(isPublicBotRoute(path), path).toBe(false);
    }
  });

  it("no se puede escapar con .. porque se evalua el pathname normalizado", () => {
    expect(pathOf("/.well-known/../admin/")).toBe("/admin/");
    expect(isPublicBotRoute(pathOf("/.well-known/../admin/"))).toBe(false);
    expect(isPublicBotRoute(pathOf("/blog/../admin/x.md"))).toBe(false);
  });
});
