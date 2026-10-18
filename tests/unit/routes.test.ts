// src/lib/routes.ts -- la unica fuente de las rutas publicas. Puro (sin
// astro:content): lo consumen src/, functions/ y server/, y se prueba con
// vitest igual que docs-nav / sitemap / llms-txt.
import { describe, it, expect } from "vitest";
import {
  ROUTES,
  systemHref,
  contentPagePath,
  contentPageHref,
  resolveLegacyRedirect,
  LEGACY_ROUTES,
} from "../../src/lib/routes";

describe("ROUTES -- una sola fuente", () => {
  it("expone las rutas canonicas del sistema", () => {
    expect(ROUTES.BETA).toBe("/beta");
    expect(ROUTES.SHOP).toBe("/tienda");
    expect(ROUTES.PROJECTIONS).toBe("/proyecciones");
    expect(ROUTES.PAGES).toBe("/paginas");
  });
});

describe("systemHref -- respeta el prefijo de locale", () => {
  it("el default va sin prefijo; los demas con /<locale>/", () => {
    expect(systemHref("BETA", "en")).toBe("/beta");
    expect(systemHref("BETA", "es")).toBe("/es/beta");
    expect(systemHref("SHOP", "en")).toBe("/tienda");
    expect(systemHref("SHOP", "es")).toBe("/es/tienda");
  });

  it("respeta el base sin doble barra", () => {
    expect(systemHref("BETA", "es", "/repo/")).toBe("/repo/es/beta");
    expect(systemHref("BETA", "en", "/repo/")).toBe("/repo/beta");
  });
});

describe("contentPagePath / contentPageHref -- contenido del usuario", () => {
  it("la primaria va sin prefijo; la traduccion con su locale", () => {
    expect(contentPagePath("bio")).toBe("/paginas/bio/");
    expect(contentPagePath("bio", "es")).toBe("/es/paginas/bio/");
    expect(contentPageHref("bio", undefined, "/repo/")).toBe("/repo/paginas/bio/");
    expect(contentPageHref("bio", "es", "/repo/")).toBe("/repo/es/paginas/bio/");
  });

  it("descarta segmentos de traversal (sin path traversal en el slug)", () => {
    expect(contentPagePath("a/b")).toBe("/paginas/a/b/");
    expect(contentPagePath("../etc")).toBe("/paginas/etc/");
    expect(contentPagePath("./x/../y")).toBe("/paginas/x/y/");
  });
});

describe("resolveLegacyRedirect -- tabla fija, sin open redirect", () => {
  it("cada fila conocida mapea preservando el idioma", () => {
    expect(resolveLegacyRedirect("/paginas/jerry-bantz/")).toBe("/paginas/jerry-bantz/");
    expect(resolveLegacyRedirect("/es/paginas/bio/")).toBe("/es/paginas/bio/");
    expect(resolveLegacyRedirect("/tienda/")).toBe("/es/tienda/");
    expect(resolveLegacyRedirect("/tienda/polera/")).toBe("/tienda/polera/");
    expect(resolveLegacyRedirect("/en/tienda/")).toBe("/tienda/");
    expect(resolveLegacyRedirect("/proyecciones/")).toBe("/es/proyecciones/");
    expect(resolveLegacyRedirect("/en/proyecciones/")).toBe("/proyecciones/");
    expect(resolveLegacyRedirect("/en/beta/")).toBe("/beta/");
    expect(resolveLegacyRedirect("/docs/primos-pasos/")).toBe("/docs/primos-pasos/");
    expect(resolveLegacyRedirect("/docs/primos-pasos.md")).toBe("/docs/primos-pasos.md");
  });

  it("preserva el query string", () => {
    expect(resolveLegacyRedirect("/paginas/bio/?x=1")).toBe("/paginas/bio/?x=1");
  });

  it("preserva el idioma en la redireccion de la raiz editorial", () => {
    expect(resolveLegacyRedirect("/proyecciones/")).toBe("/es/proyecciones/");
    expect(resolveLegacyRedirect("/tienda/")).toBe("/es/tienda/");
  });

  it("NO redirige nada que no sea una ruta legada conocida", () => {
    expect(resolveLegacyRedirect("/pages/bio/")).toBeNull();
    expect(resolveLegacyRedirect("/blog/bienvenida/")).toBeNull();
    expect(resolveLegacyRedirect("/paginas/../etc/passwd")).toBeNull();
    expect(resolveLegacyRedirect("/paginas/b/o/x")).toBeNull();
    expect(resolveLegacyRedirect("/external//paginas/bio/")).toBeNull();
  });

  it("todo patron de la tabla es cerrado (sin comodines abiertos)", () => {
    for (const rule of LEGACY_ROUTES) {
      const src = String(rule.from);
      expect((src.match(/\(\?|\.|%2F/g) ?? []).length, src).toBeLessThanOrEqual(1);
      expect(src, rule.from.source).not.toContain("(?:.*)");
      expect(src).not.toContain("(.*)");
      expect(src).not.toContain("%2F");
    }
  });
});
