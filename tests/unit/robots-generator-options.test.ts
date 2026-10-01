import { describe, expect, it } from "vitest";
import { generateRobotsTxt } from "../../packages/trust-layer/src/policy/robots-generator.ts";
import { defaultContentPolicy } from "../../packages/trust-layer/src/policy/manifest-schema.ts";
import { isCompleteManifest } from "../../src/lib/content-policy.ts";

describe("generateRobotsTxt con opciones (PR F)", () => {
  const manifest = defaultContentPolicy("https://a.com");

  it("sin opciones no agrega Disallow ni comentario de llms.txt", () => {
    const txt = generateRobotsTxt(manifest);
    expect(txt).not.toContain("Disallow:");
    expect(txt).not.toContain("llmstxt.org");
    expect(txt).toContain("# para condiciones de pago y excepciones por operador.\n\nUser-agent: *\nAllow: /\n");
    expect(txt).toContain(`Sitemap: ${manifest.site}/sitemap.xml\n`);
  });

  it("con opciones respeta base, bloquea /admin/ y enlaza llms.txt y la politica", () => {
    const txt = generateRobotsTxt(manifest, {
      disallow: ["/repo/admin/"],
      sitemapUrl: "https://a.com/repo/sitemap.xml",
      llmsTxtUrl: "https://a.com/repo/llms.txt",
      policyUrl: "https://a.com/repo/.well-known/portaless-content-policy.json",
    });
    expect(txt).toContain("User-agent: *\nDisallow: /repo/admin/\nAllow: /\n");
    expect(txt).toContain("Sitemap: https://a.com/repo/sitemap.xml\n");
    expect(txt).toContain("# Indice para LLMs (llmstxt.org): https://a.com/repo/llms.txt\n");
    expect(txt).toContain("# Politica legible por humanos: ver https://a.com/repo/.well-known/portaless-content-policy.json\n");
  });

  it("emite Content-Signal con no para las politicas bloqueadas", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked: any = {
      ...manifest,
      policies: { ...manifest.policies, ai_train: { ...manifest.policies.ai_train, access: "block" } },
    };
    expect(generateRobotsTxt(blocked)).toMatch(/Content-Signal: search=\w+, ai-input=\w+, ai-train=no/);
  });
});

describe("isCompleteManifest", () => {
  it("acepta el manifiesto por defecto y rechaza uno sin politicas", () => {
    expect(isCompleteManifest(defaultContentPolicy("https://a.com"))).toBe(true);
    expect(isCompleteManifest({ version: "0.1", site: "https://a.com", policies: { search: { access: "allow" } } })).toBe(false);
    expect(isCompleteManifest(null)).toBe(false);
  });
});
