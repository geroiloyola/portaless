// src/lib/routes.ts -- la unica fuente de las rutas publicas. Puro (sin
// astro:content): lo consumen src/, functions/ y server/, y se prueba con
// vitest igual que docs-nav / sitemap / llms-txt.
//
// OJO: las EXPECTATIVAS de la tabla LEGACY usan las rutas VIEJAS a proposito
// (es su trabajo: mapean URLs de antes de la refactorizacion).
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
  it("expone las rutas canonicas del sistema (ingles sin prefijo)", () => {
    expect(ROUTES.BETA).toBe("/beta");
    expect(ROUTES.SHOP).toBe("/shop");
    expect(ROUTES.PROJECTIONS).toBe("/projections");
    expect(ROUTES.PAGES).toBe("/pages");
  });
});

describe("systemHref -- respeta el prefijo de locale", () => {
  it("el default va sin prefijo; los demas con /<locale>/", () => {
    expect(systemHref("BETA", "en")).toBe("/beta");
    expect(systemHref("BETA", "es")).toBe("/es/beta");
    expect(systemHref("SHOP", "en")).toBe("/shop");
    expect(systemHref("SHOP", "es")).toBe("/es/shop");
    expect(systemHref("PROJECTIONS", "en")).toBe("/projections");
    expect(systemHref("PROJECTIONS", "es")).toBe("/es/projections");
  });

  it("respeta el base sin doble barra", () => {
    expect(systemHref("BETA", "es", "/repo/")).toBe("/repo/es/beta");
    expect(systemHref("BETA", "en", "/repo/")).toBe("/repo/beta");
  });
});

describe("contentPagePath / contentPageHref -- contenido del usuario", () => {
  it("la primaria va sin prefijo; la traduccion con su locale", () => {
    expect(contentPagePath("bio")).toBe("/pages/bio/");
    expect(contentPagePath("bio", "es")).toBe("/es/pages/bio/");
    expect(contentPageHref("bio", undefined, "/repo/")).toBe("/repo/pages/bio/");
    expect(contentPageHref("bio", "es", "/repo/")).toBe("/repo/es/pages/bio/");
  });

  it("descarta segmentos de traversal (sin path traversal en el slug)", () => {
    expect(contentPagePath("a/b")).toBe("/pages/a/b/");
    expect(contentPagePath("../etc")).toBe("/pages/etc/");
    expect(contentPagePath("./x/../y")).toBe("/pages/x/y/");
  });
});

describe("resolveLegacyRedirect -- tabla fija, sin open redirect", () => {
  it("cada fila conocida mapea preservando el idioma", () => {
    expect(resolveLegacyRedirect("/paginas/jerry-bantz/")).toBe("/pages/jerry-bantz/");
    expect(resolveLegacyRedirect("/es/paginas/bio/")).toBe("/es/pages/bio/");
    expect(resolveLegacyRedirect("/en/paginas/bio/")).toBe("/pages/bio/");
    expect(resolveLegacyRedirect("/pages/bio/")).toBeNull(); // ya es ruta nueva
    expect(resolveLegacyRedirect("/tienda/")).toBe("/es/shop/");
    expect(resolveLegacyRedirect("/tienda/polera/")).toBe("/shop/polera/");
    expect(resolveLegacyRedirect("/en/tienda/")).toBe("/shop/");
    expect(resolveLegacyRedirect("/proyecciones/")).toBe("/es/projections/");
    expect(resolveLegacyRedirect("/en/proyecciones/")).toBe("/projections/");
    expect(resolveLegacyRedirect("/en/beta/")).toBe("/beta/");
    expect(resolveLegacyRedirect("/docs/primos-pasos/")).toBe("/docs/first-steps/");
    expect(resolveLegacyRedirect("/docs/primos-pasos.md")).toBe("/docs/first-steps.md");
  });

  it("preserva el query string", () => {
    expect(resolveLegacyRedirect("/paginas/bio/?x=1")).toBe("/pages/bio/?x=1");
    expect(resolveLegacyRedirect("/tienda/?ref=mar")).toBe("/es/shop/?ref=mar");
  });

  it("NO redirige nada que no sea una ruta legada conocida", () => {
    expect(resolveLegacyRedirect("/shop/")).toBeNull(); // ya es nueva
    expect(resolveLegacyRedirect("/blog/bienvenida/")).toBeNull();
    expect(resolveLegacyRedirect("/paginas/../etc/passwd")).toBeNull();
    expect(resolveLegacyRedirect("/paginas/b/o/x")).toBeNull();
    expect(resolveLegacyRedirect("/external//paginas/bio/")).toBeNull();
  });

  it("todo patron de la tabla es cerrado (sin comodines abiertos)", () => {
    for (const rule of LEGACY_ROUTES) {
      const src = String(rule.from);
      expect(src, rule.from.source).not.toContain("(.*)");
      expect(src).not.toContain("(?:.*)");
      expect(src).not.toContain("%2F");
    }
  });
});
