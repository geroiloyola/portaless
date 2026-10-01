import { describe, expect, it } from "vitest";
import {
  AI_INPUT_BLOCKED_NOTICE,
  buildLlmsTxt,
  joinSiteUrl,
  publishedPosts,
} from "../../src/lib/llms-txt.ts";

const POLICY = "https://a.com/.well-known/portaless-content-policy.json";

describe("buildLlmsTxt", () => {
  it("sigue el formato de llmstxt.org: H1, resumen, secciones y Optional", () => {
    const txt = buildLlmsTxt({
      siteName: "Mi sitio",
      summary: "Un blog\nsobre confianza",
      sections: [{ heading: "Posts", links: [{ title: "Hola", url: "https://a.com/blog/hola.md", note: "Primer post" }] }],
      policyUrl: POLICY,
    });
    expect(txt).toBe(
      "# Mi sitio\n\n" +
        "> Un blog sobre confianza\n\n" +
        "## Posts\n\n" +
        "- [Hola](https://a.com/blog/hola.md): Primer post\n\n" +
        "## Optional\n\n" +
        `- [Política de contenido](${POLICY}): Condiciones de uso, pago y excepciones por operador\n`
    );
  });

  it("escapa corchetes y aplana saltos de linea en los titulos", () => {
    const txt = buildLlmsTxt({
      siteName: "S",
      sections: [{ heading: "Posts", links: [{ title: "Guía [beta]\nparte 2", url: "https://a.com/x.md" }] }],
    });
    expect(txt).toContain("- [Guía \\[beta\\] parte 2](https://a.com/x.md)\n");
  });

  it("codifica espacios y parentesis en las URLs", () => {
    const txt = buildLlmsTxt({
      siteName: "S",
      sections: [{ heading: "Posts", links: [{ title: "T", url: "https://a.com/a (b).md" }] }],
    });
    expect(txt).toContain("(https://a.com/a%20%28b%29.md)");
  });

  it("omite secciones vacias y sin politica no agrega Optional", () => {
    const txt = buildLlmsTxt({ siteName: "S", sections: [{ heading: "Posts", links: [] }] });
    expect(txt).toBe("# S\n");
  });

  it("si ai_input esta bloqueado no lista contenido y enlaza la politica", () => {
    const txt = buildLlmsTxt({
      siteName: "S",
      summary: "Resumen",
      sections: [{ heading: "Posts", links: [{ title: "Privado", url: "https://a.com/p.md" }] }],
      optional: [{ title: "Extra", url: "https://a.com/e.md" }],
      aiInputAllowed: false,
      policyUrl: POLICY,
    });
    expect(txt).toContain(AI_INPUT_BLOCKED_NOTICE);
    expect(txt).toContain(POLICY);
    expect(txt).not.toContain("## Posts");
    expect(txt).not.toContain("https://a.com/p.md");
    expect(txt).not.toContain("https://a.com/e.md");
  });

  it("usa Portaless como H1 si el nombre viene vacio", () => {
    expect(buildLlmsTxt({ siteName: "  ", sections: [] })).toBe("# Portaless\n");
  });
});

describe("joinSiteUrl", () => {
  it("respeta el base de Astro en todas sus formas", () => {
    expect(joinSiteUrl("https://a.com", "/", "/llms.txt")).toBe("https://a.com/llms.txt");
    expect(joinSiteUrl("https://a.com", "/repo/", "/llms.txt")).toBe("https://a.com/repo/llms.txt");
    expect(joinSiteUrl("https://a.com/", "repo", "blog/x.md")).toBe("https://a.com/repo/blog/x.md");
    expect(joinSiteUrl("https://a.com", "", "/x")).toBe("https://a.com/x");
  });
});

describe("publishedPosts", () => {
  it("excluye borradores y ordena del mas nuevo al mas viejo", () => {
    const posts = [
      { id: "viejo", data: { pubDate: new Date("2026-01-01"), draft: false } },
      { id: "borrador", data: { pubDate: new Date("2026-09-01"), draft: true } },
      { id: "nuevo", data: { pubDate: new Date("2026-06-01"), draft: false } },
    ];
    expect(publishedPosts(posts).map((p) => p.id)).toEqual(["nuevo", "viejo"]);
  });
});
