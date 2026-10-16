// El home (src/content/home.json + src/pages/index.astro) es la primera
// superficie publica del producto, asi que hereda las reglas de honestidad de
// la VISION: nada de metricas, testimonios ni logos fabricados, y la frase
// §12.4 (quien puede leer tu sitio, por escrito) presente. Tambien fija que el
// home sea 100% motor (renderPage) y que la lista de posts use el filtro
// canonico, no una copia propia.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const homeJson = readFileSync(join(root, "src/content/home.json"), "utf8");
const indexSrc = readFileSync(join(root, "src/pages/index.astro"), "utf8");

describe("home: honestidad (nada fabricado)", () => {
  const forbidden = [
    /\b92\b/, // el viejo "92 Veraciers"
    /32K\+/,
    /trusted by/i,
    /\b\d{2,}\s*%/,
    /\b\d{2,}(\.\d+)?\s*(stars|users|customers|sites|veraciers)\b/i,
  ];

  it("no contiene metricas, porcentajes ni 'trusted by' inventados", () => {
    for (const re of forbidden) {
      expect(homeJson, `home.json no debe contener ${re}`).not.toMatch(re);
    }
  });

  it("la frase §12.4 sigue en el home, en ingles", () => {
    expect(homeJson).toContain("who may read your site");
    expect(homeJson).toContain("in writing");
  });
});

describe("home: 100% motor", () => {
  it("se renderiza con renderPage, no con HTML a mano", () => {
    expect(indexSrc).toContain("renderPage(");
    // El contenido no se escribe a mano en el .astro: no hay <h1>/<p> de copy.
    expect(indexSrc).not.toMatch(/<h1[\s>]/);
  });

  it("la lista de posts usa el filtro canonico (publishedPosts), no una copia", () => {
    expect(indexSrc).toContain("publishedPosts(");
  });

  it("declara el theme pack del home", () => {
    expect(homeJson).toContain('"theme": "home-nocturno"');
  });

  it("el theme pack home-nocturno existe en los builtins", () => {
    const themes = readFileSync(join(root, "packages/atomic-elements/src/themes/theme-pack.ts"), "utf8");
    expect(themes).toContain('name: "home-nocturno"');
  });
});
