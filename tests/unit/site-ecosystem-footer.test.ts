// Footer del ecosistema Portaless: TrustScore · Explore · Powered by
// Portaless, y jamas un link roto. Tres contratos:
//   1. Los tres labels de la fila de ecosistema estan.
//   2. TrustScore apunta al siteId REAL (SITE_ID de site-skin-store); el
//      valor se duplica en Footer.astro porque ese modulo importa
//      openSqlite y no puede entrar al build estatico -- este test es lo
//      que evita que se desincronice.
//   3. Explore apunta a una pagina que existe en el repo.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE_ID } from "../../packages/dashboard/src/skin-engine/site-skin-store";

const root = join(__dirname, "../..");
const footerSrc = readFileSync(join(root, "src/components/Footer.astro"), "utf8");

describe("footer del ecosistema Portaless", () => {
  it("dice TrustScore · Explore · Powered by Portaless", () => {
    expect(footerSrc).toContain(">TrustScore<");
    expect(footerSrc).toContain(">Explore<");
    expect(footerSrc).toContain("Powered by Portaless");
    expect(footerSrc).toContain('aria-label="Ecosistema Portaless"');
  });

  it("TrustScore apunta al hub /trust/, que resuelve el siteId real por defecto", () => {
    // Antes apuntaba a /trust/default, que da 404 en el deploy estatico (no hay
    // functions/). El hub /trust/ existe en dist y cae al siteId real cuando la
    // URL no trae uno (ver src/pages/trust/index.astro).
    expect(footerSrc).toContain("trust/");
    expect(footerSrc).not.toContain("trust/default");
    const trustPage = readFileSync(join(root, "src/pages/trust/index.astro"), "utf8");
    expect(trustPage).toContain(`: "${SITE_ID}"`);
  });

  it("Explore apunta a una pagina que existe -- sin links rotos", () => {
    expect(footerSrc).toContain("explore/");
    expect(existsSync(join(root, "src/pages/explore.astro"))).toBe(true);
  });

  it("la fila 2 dice exactamente el posicionamiento del producto", () => {
    expect(footerSrc).toContain("Open Source, Modular, Agent-Ready & Zero-Hosting");
  });

  it("el hub de descubrimiento usa el filtro de publicacion canónico", () => {
    // Desde i18n (docs/i18n-design.md) el hub vive en la vista compartida
    // ExplorePage.astro (dos proyecciones de locale), no en explore.astro.
    const exploreSrc = readFileSync(join(root, "src/components/ExplorePage.astro"), "utf8");
    expect(exploreSrc).toContain("draft-filter");
    expect(exploreSrc).toContain("isDraft");
  });
});

// El shell de functions/pages/[slug].js DUPLICA header/footer (es lo
// que servia "licencia MIT" mientras Astro decia AGPL -- bug ya
// ocurrido). Paridad obligatoria: las dos superficies tienen que decir
// exactamente lo mismo.
describe("paridad static <-> runtime (functions/pages/[slug].js)", () => {
  const shellSrc = readFileSync(join(root, "functions/pages/[slug].js"), "utf8");

  it("el footer runtime dice TrustScore · Explore · Powered by Portaless", () => {
    expect(shellSrc).toContain(">TrustScore<");
    expect(shellSrc).toContain(">Explore<");
    expect(shellSrc).toContain("Powered by Portaless");
    expect(shellSrc).toContain('href="/trust/"');
    expect(shellSrc).toContain("/explore/");
    expect(shellSrc).not.toContain("Hecho con");
  });

  it("el header runtime usa el vocabulario de site-lang, nunca Blog", () => {
    expect(shellSrc).toContain("postsLabel(SITE_LANG)");
    expect(shellSrc).toContain("SITE_LANG");
    expect(shellSrc).not.toMatch(/>Blog</);
  });

  it("ambas superficies dicen el posicionamiento exacto, letra por letra", () => {
    for (const src of [footerSrc, shellSrc]) {
      expect(src).toContain("Open Source, Modular, Agent-Ready & Zero-Hosting");
    }
  });
});
