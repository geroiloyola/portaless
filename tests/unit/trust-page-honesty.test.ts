// Honestidad de la superficie PUBLICa de TrustScore (GET /trust/default, la
// pagina que enlaza el footer desde todo el sitio). Hasta la Fase 12 mostraba
// once valores escritos a mano -- "92 Veraciers", "98%", "32K+", "4.9", etc. --
// que ningun codigo calculaba y que la ERRATA E-13 ya habia retirado del
// computo. Es un test de FUENTE a proposito: impide que un literal inventado
// vuelva a entrar sin que CI lo note (mismo patron que
// site-ecosystem-footer.test.ts, que fija constantes a nivel de fuente).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const trustPage = readFileSync(join(root, "src", "pages", "trust", "index.astro"), "utf8");
const jerryBantz = readFileSync(join(root, "src", "content", "pages", "jerry-bantz.json"), "utf8");

describe("página pública de TrustScore: sin valores fabricados", () => {
  it("no contiene ninguno de los literales inventados", () => {
    for (const bad of ["92 Veraciers", "98%", "95%", "100%", "Sin disputas", "4.9", "32K+"]) {
      expect(trustPage, `literal fabricado presente: ${bad}`).not.toContain(bad);
    }
  });

  it("el camino de error no inventa datos 'canónicos'", () => {
    expect(trustPage).not.toContain("identidad canónica");
    expect(trustPage).not.toContain("identidad canonica");
  });

  it("el resumen se calcula del snapshot (longitudes reales), no de un array fijo", () => {
    expect(trustPage).toContain("snapshot.self");
    expect(trustPage).toContain("snapshot.agent");
    expect(trustPage).toContain("snapshot.community");
    expect(trustPage).toContain("snapshot.escrowReports");
    expect(trustPage).toContain("Sin datos");
  });

  it("la bio de ejemplo no anuncia un conteo fabricado de Veraciers", () => {
    expect(jerryBantz).not.toContain("92 Veraciers");
    expect(jerryBantz).not.toContain("Perfil Verificado");
  });
});
