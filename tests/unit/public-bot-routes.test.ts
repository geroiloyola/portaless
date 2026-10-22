import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicBotRoute } from "../../packages/trust-layer/src/policy/public-bot-routes.ts";

const pathOf = (url: string) => new URL(url, "https://a.com").pathname;
const contract = readFileSync(join(__dirname, "../../docs/decisions/0003-public-and-governed-resource-contract.md"), "utf8");

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
    for (const path of [
      "/",
      "/blog/hola/",
      "/blog/hola",
      "/pages/inicio",
      "/docs/vision.md",
      "/revisions/123e4567-e89b-42d3-a456-426614174000/index.json",
      "/images/image-id",
      "/admin/",
      "/llms.txt.bak",
      "/robots.txt/x",
      "/blog.md",
    ]) {
      expect(isPublicBotRoute(path), path).toBe(false);
    }
  });

  it("the PR1 route contract records each current discovery exception and content family", () => {
    for (const route of [
      "`/llms.txt`",
      "`/robots.txt`",
      "`/sitemap.xml`",
      "`/rss.xml`",
      "`/blog/:slug.md`",
      "`/revisions/:publicationId/index.json`",
      "`/pages/:slug/`",
      "`/.well-known/*`",
      "`/trust/:siteId`",
    ]) {
      expect(contract, route).toContain(route);
    }
    expect(contract).toContain("proposed route contract for PR1");
  });

  it("the revised ADR fixes public-mode migration, grant-only MVP and pre-authentication prerequisites without changing the runtime", () => {
    const text = contract.replace(/\s+/g, " ");
    for (const requirement of [
      "without a signature pass anonymously",
      "strict best-effort",
      "invalid signature never degrades to anonymous",
      "Migration is explicit and opt-in",
      "MVP is **grant-only**",
      "other_automation",
      "not proof of the request's purpose",
      "x-portaless-client-ip",
      "CF-Connecting-IP",
      "Missing trusted IP or bucket secret",
      "24 hours",
      "256 KiB",
      "4096 CIDRs",
      "research only, pending verification",
    ]) expect(text.replace(/\*\*/g, ""), requirement).toContain(requirement.replace(/\*\*/g, ""));
    expect(text).toContain("PR2 must apply directory-origin and unauthenticated-client budgets");
  });

  it("no se puede escapar con .. porque se evalua el pathname normalizado", () => {
    expect(pathOf("/.well-known/../admin/")).toBe("/admin/");
    expect(isPublicBotRoute(pathOf("/.well-known/../admin/"))).toBe(false);
    expect(isPublicBotRoute(pathOf("/blog/../admin/x.md"))).toBe(false);
  });
});
