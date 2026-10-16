// Regresion: los indices de publicaciones usaban `post.slug` y con el
// glob loader de Astro v5 esa propiedad ya no existe -- salia
// href="/blog/undefined/" (404) en el home, en /blog/ y en /explore/.
// La propiedad correcta es `post.id`, la misma que usa la ruta detalle
// [...slug].astro para construir /blog/<id>/.
//
// Escanea TODOS los .astro de src/pages para que un archivo nuevo que
// copie el patron roto tambien lo atrape.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pagesDir = join(__dirname, "../../src/pages");

function astroFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return astroFiles(path);
    return entry.name.endsWith(".astro") ? [path] : [];
  });
}

const files = astroFiles(pagesDir);
const sources = files.map((file) => ({ file, src: readFileSync(file, "utf8") }));

describe("enlaces de publicaciones -> /blog/<id>/", () => {
  it("ninguna pagina arma un href con post.slug (eso da 404)", () => {
    const offenders = sources
      .filter(({ src }) => src.includes("post.slug"))
      .map(({ file }) => file.replace(`${pagesDir}/`, ""));
    expect(offenders).toEqual([]);
  });

  it("los indices usan post.id, igual que la ruta detalle", () => {
    const indexes = ["blog/index.astro", "explore.astro"];
    for (const name of indexes) {
      const src = readFileSync(join(pagesDir, name), "utf8");
      expect(src, `${name} debe linkear con post.id`).toContain("post.id");
    }
    // El home tambien: desde la fase 0 del rediseno su lista de posts vive en la
    // vista compartida (components/HomePage.astro), no en src/pages/index.astro.
    const homeView = readFileSync(join(__dirname, "../../src/components/HomePage.astro"), "utf8");
    expect(homeView, "HomePage debe linkear con post.id").toContain("post.id");
    const detail = readFileSync(join(pagesDir, "blog/[...slug].astro"), "utf8");
    expect(detail).toContain("post.id");
  });
});
