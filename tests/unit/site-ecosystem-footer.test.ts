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

  it("TrustScore apunta al siteId real, nunca a /trust/ vacio (eso muestra error)", () => {
    // El source tiene "}trust/default" (el "/" del inicio lo aporta
    // BASE_URL en runtime), por eso se busca "trust/<id>" y se prohíbe
    // que termine el template justo ahi.
    expect(footerSrc).toContain(`trust/${SITE_ID}`);
    expect(footerSrc).not.toMatch(/trust\/`/);
  });

  it("Explore apunta a una pagina que existe -- sin links rotos", () => {
    expect(footerSrc).toContain("explore/");
    expect(existsSync(join(root, "src/pages/explore.astro"))).toBe(true);
  });

  it("la fila 2 dice exactamente el posicionamiento del producto", () => {
    expect(footerSrc).toContain("Open Source, Modular, Agent-Ready & Zero-Hosting");
  });

  it("el hub de descubrimiento usa el filtro de publicacion canónico", () => {
    const exploreSrc = readFileSync(join(root, "src/pages/explore.astro"), "utf8");
    expect(exploreSrc).toContain("draft-filter");
    expect(exploreSrc).toContain("isDraft");
  });
});

// El shell de functions/paginas/[slug].js DUPLICA header/footer (es lo
// que servia "licencia MIT" mientras Astro decia AGPL -- bug ya
// ocurrido). Paridad obligatoria: las dos superficies tienen que decir
// exactamente lo mismo.
describe("paridad static <-> runtime (functions/paginas/[slug].js)", () => {
  const shellSrc = readFileSync(join(root, "functions/paginas/[slug].js"), "utf8");

  it("el footer runtime dice TrustScore · Explore · Powered by Portaless", () => {
    expect(shellSrc).toContain(">TrustScore<");
    expect(shellSrc).toContain(">Explore<");
    expect(shellSrc).toContain("Powered by Portaless");
    expect(shellSrc).toContain(`trust/${SITE_ID}`);
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
