// §13.4 -- Un canon, cinco proyecciones (docs/VISION.md, "One canon, many
// projections"). El contrato que este test protege:
//   1. Son CINCO, en el orden que enumera VISION.md.
//   2. Cada una se DERIVA del canon: cambiar el canon cambia la salida.
//   3. Si una proyeccion no lleva el canon, no coincide -- gana el canon.
//   4. Lo que necesita un nodo se marca "requiere nodo", nunca en verde.
//   5. La demo esta enlazada y el sitemap la lista (sin links rotos).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECTION_IDS,
  canonicalUrl,
  containsCanon,
  markdownUrl,
  projectionsFor,
  type Canon,
  type ProjectionContext,
} from "../../src/lib/projections";
import { buildRssXml } from "../../src/lib/rss";

const root = join(__dirname, "../..");

const CTX: ProjectionContext = {
  siteUrl: "https://sitio.example",
  base: "/repo",
  siteName: "Portaless",
  summary: "Sitio construido con Portaless",
  siteId: "sitio.example",
};

function canon(overrides: Partial<Canon> = {}): Canon {
  return {
    kind: "post",
    id: "bienvenida",
    source: "src/content/posts/bienvenida.md",
    title: "Bienvenido a tu sitio",
    description: "El primer articulo.",
    pubDate: new Date("2026-09-12T00:00:00Z"),
    path: "/blog/bienvenida",
    ...overrides,
  };
}

describe("cinco proyecciones, en el orden de VISION.md", () => {
  it("son exactamente paginas, feed, manifiesto, indice y plataforma", () => {
    const ids = projectionsFor(canon(), CTX).map((p) => p.id);
    expect(ids).toEqual(["page", "feed", "manifest", "index", "platform"]);
    expect(ids).toEqual([...PROJECTION_IDS]);
  });

  it("las verificables en build coinciden; las que necesitan nodo no fingen", () => {
    for (const projection of projectionsFor(canon(), CTX)) {
      if (projection.id === "manifest" || projection.id === "platform") {
        expect(projection.state, projection.id).toBe("node");
        expect(projection.match, projection.id).toBeNull();
      } else {
        expect(projection.state, projection.id).toBe("live");
        expect(projection.match, projection.id).toBe(true);
      }
    }
  });
});

describe("cada proyeccion se deriva del canon (no es una copia fija)", () => {
  it("cambiar el titulo del canon cambia feed e indice, pero no la URL", () => {
    const before = projectionsFor(canon({ title: "Titulo viejo" }), CTX);
    const after = projectionsFor(canon({ title: "Titulo nuevo" }), CTX);
    const byId = <T extends { id: string }>(list: T[], id: string) =>
      list.find((p) => p.id === id)!.derived;

    expect(byId(before, "feed")).toContain("Titulo viejo");
    expect(byId(after, "feed")).toContain("Titulo nuevo");
    expect(byId(after, "feed")).not.toContain("Titulo viejo");

    expect(byId(before, "index")).toContain("Titulo viejo");
    expect(byId(after, "index")).toContain("Titulo nuevo");

    // La URL canonica no depende del titulo: es la misma en las dos.
    expect(canonicalUrl(canon({ title: "Titulo viejo" }), CTX)).toBe(
      canonicalUrl(canon({ title: "Titulo nuevo" }), CTX)
    );
  });

  it("todas las proyecciones de contenido apuntan a la URL canonica", () => {
    const c = canon();
    const url = canonicalUrl(c, CTX);
    for (const projection of projectionsFor(c, CTX)) {
      if (projection.id === "page" || projection.id === "feed" || projection.id === "index") {
        expect(projection.derived, projection.id).toContain(url);
      }
    }
  });
});

describe("gana el canon", () => {
  it("una salida generada desde otro canon NO coincide con este", () => {
    const a = canon({ title: "Alfa" });
    const b = canon({ title: "Beta" });
    const urlA = canonicalUrl(a, CTX);
    // Un feed construido desde el canon B: titulo distinto, misma URL.
    const staleFeed = buildRssXml({
      siteName: CTX.siteName,
      siteUrl: `${CTX.siteUrl}/`,
      feedUrl: `${CTX.siteUrl}/rss.xml`,
      items: [{ title: b.title, url: urlA, pubDate: b.pubDate }],
    });
    expect(containsCanon(staleFeed, a, urlA)).toBe(false);
    expect(containsCanon(staleFeed, b, urlA)).toBe(true);
  });

  it("una salida identica al canon si coincide", () => {
    const c = canon();
    const url = canonicalUrl(c, CTX);
    const feed = buildRssXml({
      siteName: CTX.siteName,
      siteUrl: `${CTX.siteUrl}/`,
      feedUrl: `${CTX.siteUrl}/rss.xml`,
      items: [{ title: c.title, url, pubDate: c.pubDate }],
    });
    expect(containsCanon(feed, c, url)).toBe(true);
  });
});

describe("URLs del canon", () => {
  it("la canonica lleva barra final y respeta el base; la markdown no", () => {
    const c = canon();
    expect(canonicalUrl(c, CTX)).toBe("https://sitio.example/repo/blog/bienvenida/");
    expect(markdownUrl(c, CTX)).toBe("https://sitio.example/repo/blog/bienvenida.md");
  });
});

describe("la demo esta enlazada y sin links rotos", () => {
  it("existe la pagina /proyecciones/", () => {
    expect(existsSync(join(root, "src/pages/proyecciones.astro"))).toBe(true);
  });

  it("Explore y el post enlazan a la demo", () => {
    expect(readFileSync(join(root, "src/components/ExplorePage.astro"), "utf8")).toContain("proyecciones/");
    expect(readFileSync(join(root, "src/pages/blog/[...slug].astro"), "utf8")).toContain("proyecciones/");
  });

  it("el sitemap lista /proyecciones/", () => {
    expect(readFileSync(join(root, "src/pages/sitemap.xml.ts"), "utf8")).toContain('"/proyecciones/"');
  });
});

describe("proyecciones: metadata por locale (i18n)", () => {
  it("locale 'es' (default) mantiene los titulos en espanol", () => {
    const titles = projectionsFor(canon(), CTX).map((p) => p.title);
    expect(titles).toEqual(["Página", "Feed", "Manifiesto", "Índice", "Otra plataforma"]);
  });

  it("locale 'en' traduce titulos y notas (el channel tecnico no se traduce)", () => {
    const ps = projectionsFor(canon(), CTX, "en");
    expect(ps.map((p) => p.title)).toEqual(["Page", "Feed", "Manifest", "Index", "Another platform"]);
    expect(ps[0].channel).toBe("HTML"); // identificador tecnico, sin traducir
    expect(ps[0].note).toContain("Rendered from the canon");
    expect(ps[2].note).toContain("Signed per request");
  });

  it("los cinco ids no cambian entre locales (mismo contrato)", () => {
    expect(projectionsFor(canon(), CTX, "en").map((p) => p.id)).toEqual([...PROJECTION_IDS]);
  });
});
