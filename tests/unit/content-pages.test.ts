// Paginas de contenido multilocale (src/lib/content-pages.ts): el idioma sale
// del NOMBRE DEL ARCHIVO (`<slug>.json` = primaria, `<slug>.<locale>.json` =
// traduccion), y cada version tiene su ruta (primaria sin prefijo, traduccion
// con el suyo). Puro: se prueba sin Astro.
import { describe, it, expect } from "vitest";
import {
  parsePagePath,
  groupContentPages,
  versionHref,
  CONTENT_PRIMARY_LOCALE,
  type PageVersion,
} from "../../src/lib/content-pages";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

function layout(slug: string, locale?: string): PageLayout {
  return { version: "0.1", slug, title: slug, locale, root: [] };
}

describe("parsePagePath", () => {
  it("un archivo sin sufijo es la version primaria", () => {
    expect(parsePagePath("../content/pages/bio.json")).toEqual({ slug: "bio", fileLocale: undefined });
  });

  it("un archivo con sufijo de locale es una traduccion", () => {
    expect(parsePagePath("../content/pages/bio.en.json")).toEqual({ slug: "bio", fileLocale: "en" });
    expect(parsePagePath("../content/pages/bio.es.json")).toEqual({ slug: "bio", fileLocale: "es" });
  });

  it("un punto que no es locale no se interpreta como sufijo", () => {
    expect(parsePagePath("../content/pages/v1.2.json")).toEqual({ slug: "v1.2", fileLocale: undefined });
  });
});

describe("groupContentPages", () => {
  it("agrupa primaria + traducciones por slug", () => {
    const pages = groupContentPages({
      "../content/pages/bio.json": { default: layout("bio") },
      "../content/pages/bio.en.json": { default: layout("bio", "en") },
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].slug).toBe("bio");
    expect(pages[0].primary.locale).toBe(CONTENT_PRIMARY_LOCALE);
    expect(pages[0].versions.map((v) => v.locale).sort()).toEqual(["en", "es"]);
    expect(pages[0].versions.find((v) => v.locale === "en")?.primary).toBe(false);
  });

  it("una traduccion sin primaria NO se publica", () => {
    const pages = groupContentPages({
      "../content/pages/huerfana.en.json": { default: layout("huerfana", "en") },
    });
    expect(pages).toHaveLength(0);
  });

  it("el campo locale de la primaria puede declarar su idioma", () => {
    const pages = groupContentPages({
      "../content/pages/home.json": { default: layout("home", "en") },
      "../content/pages/home.es.json": { default: layout("home", "es") },
    });
    expect(pages[0].primary.locale).toBe("en");
  });
});

describe("versionHref", () => {
  const primary: PageVersion = { slug: "bio", locale: "es", primary: true, layout: layout("bio") };
  const en: PageVersion = { slug: "bio", locale: "en", primary: false, layout: layout("bio", "en") };

  it("la primaria va sin prefijo; la traduccion con su locale", () => {
    expect(versionHref(primary, "/")).toBe("/pages/bio/");
    expect(versionHref(en, "/")).toBe("/en/pages/bio/");
  });

  it("respeta el base de Astro", () => {
    expect(versionHref(primary, "/portaless/")).toBe("/portaless/pages/bio/");
    expect(versionHref(en, "/portaless/")).toBe("/portaless/en/pages/bio/");
  });
});
