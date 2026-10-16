// Paridad de emision del tema por pagina entre los DOS caminos de render:
// src/layouts/BaseLayout.astro (build estatico, usado por
// src/pages/paginas/[slug].astro) y functions/paginas/[slug].js (runtime,
// pagina servida desde la base). Mismo patron que
// site-ecosystem-footer.test.ts: se leen las fuentes y se fija el contrato
// con el que deben coincidir, mas la resolucion real del contenido JSON.
//
// Contrato de cascada (verificado en el build, no es una preferencia):
// las variables van como atributo style en <html>, NUNCA como regla
// :root[data-theme-pack]. Astro inyecta el <link> de global.css (bloque
// @media oscuro, especificidad 0,2,0) despues del contenido estatico del
// head, asi que una regla de tema perderia el empate por orden en
// sistemas en modo oscuro; un inline gana siempre. Este archivo fija las
// DOS mitades de esa decision (emision + ausencia de la regla).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_THEMES,
  resolveThemePack,
  themeStyleDecl,
  validateThemePack,
} from "../../packages/atomic-elements/src/themes/theme-pack";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const root = join(__dirname, "../..");
const baseLayout = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");
const slugRoute = readFileSync(join(root, "src/pages/paginas/[slug].astro"), "utf8");
const runtimeFn = readFileSync(join(root, "functions/paginas/[slug].js"), "utf8");

describe("BaseLayout (build estatico) emite el tema", () => {
  it("declara pageTheme en Props y lo pega en <html> como data-theme-pack + style", () => {
    expect(baseLayout).toMatch(/export interface Props \{[\s\S]*pageTheme\?: \{ name: string; css: string \}/);
    expect(baseLayout).toContain(
      '<html lang={lang} data-theme-pack={pageTheme?.name} style={pageTheme?.css || undefined}>'
    );
  });

  it("emite las variables como atributo inline, NUNCA como regla :root de hoja", () => {
    expect(baseLayout).not.toContain(":root[data-theme-pack]");
    // El tema NUNCA se inyecta via set:html (HTML crudo: si un pack
    // llegara ahi seria un vector de inyeccion). El unico set:html del
    // layout es el listener de volumen -- constante interna del repo,
    // sin datos de usuario, cableada desde el modulo compartido. El CSS
    // del tema va unicamente por el atributo style de <html>.
    expect(baseLayout).not.toMatch(/set:html=\{[^}]*[Tt]heme/);
    // la nota de cascada explica por que (Astro hoistea global.css despues)
    expect(baseLayout).toContain("atributo style inline gana a cualquier regla de");
  });
});

describe("pagina estatica [slug].astro resuelve el tema", () => {
  it("usa el catalogo builtin y pasa pageTheme al layout", () => {
    expect(slugRoute).toContain("BUILTIN_THEMES");
    expect(slugRoute).toContain("resolveThemePack(BUILTIN_THEMES, layout.theme)");
    expect(slugRoute).toContain("pageTheme={pageTheme}");
    expect(slugRoute).toContain("themeStyleDecl(resolvedTheme)");
  });
});

describe("shell runtime functions/paginas/[slug].js emite el tema", () => {
  it("importa los mismos helpers puros desde theme-pack", () => {
    expect(runtimeFn).toMatch(/from "\.\.\/\.\.\/packages\/atomic-elements\/src\/themes\/theme-pack\.ts"/);
    expect(runtimeFn).toContain("BUILTIN_THEMES");
    expect(runtimeFn).toContain("resolveThemePack(BUILTIN_THEMES, layout.theme)");
    expect(runtimeFn).toContain("themeStyleDecl(pageTheme)");
  });

  it("mismos atributos en <html> que BaseLayout (data-theme-pack + style inline)", () => {
    expect(runtimeFn).toContain('<html lang="${SITE_LANG}"${themeAttr}${themeStyleAttr}>');
    expect(runtimeFn).toContain('data-theme-pack="${esc(pageTheme.name)}"');
    expect(runtimeFn).toContain('` style="${esc(themeCss)}"`');
    expect(runtimeFn).not.toContain(":root[data-theme-pack]");
  });
});

describe("el contenido real resuelve contra los builtins", () => {
  it("jerry-bantz aplica 2pac-dark y su declaracion sale completa", () => {
    const layout = JSON.parse(readFileSync(join(root, "src/content/pages/jerry-bantz.json"), "utf8"));
    expect(layout.theme).toBe("2pac-dark");
    const resolved = resolveThemePack(BUILTIN_THEMES, layout.theme);
    expect(resolved).not.toBeNull();
    const decl = themeStyleDecl(resolved!);
    expect(decl).toContain("--bg:#14100C");
    expect(decl).toContain("--accent:#F05D23");
    expect(validateThemePack(BUILTIN_THEMES.find((t) => t.name === layout.theme)!).valid).toBe(true);
  });

  it("TODA pagina JSON con theme resuelve (nadie puede declarar un tema roto y publicarlo)", () => {
    const dir = join(root, "src/content/pages");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const layout = JSON.parse(readFileSync(join(dir, file), "utf8")) as PageLayout;
      if (layout.theme === undefined) continue;
      expect(
        resolveThemePack(BUILTIN_THEMES, layout.theme),
        `${file} declara theme="${layout.theme}" que no resuelve`
      ).not.toBeNull();
    }
  });
});
