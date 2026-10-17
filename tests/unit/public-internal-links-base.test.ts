// Enlaces y assets internos escritos a mano en superficies PUBLICAS (.astro)
// tienen que pasar por import.meta.env.BASE_URL. Astro NO reescribe los strings
// literales, asi que un `href="/paginas/x/"` funciona en dev (base "/") y da 404
// en un deploy con subpath (GitHub Pages /portaless/). El bug de beta.astro:25
// ("Ver el sitio de ejemplo") fue exactamente eso: el fix previo cubria el
// pipeline de contenido JSON, pero este archivo escrito a mano quedo afuera.
//
// Se excluye src/pages/admin/**: el panel es dinamico (requiere functions/),
// solo corre self-host con base "/", y ahi los literales son correctos.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...astroFiles(p));
    else if (entry.endsWith(".astro")) out.push(p);
  }
  return out;
}

const files = ["src/pages", "src/components", "src/layouts"]
  .flatMap((d) => astroFiles(join(root, d)))
  .filter((f) => !f.includes("/src/pages/admin/"));

// href/src con ruta interna literal (empieza con "/" y no es "//"): no cubre
// plantillas (`href={`${base}...`}`) ni URLs externas.
const LITERAL_INTERNAL = /(?:href|src)="\/(?!\/)[^"]*"/g;

describe("enlaces internos de superficies publicas usan BASE_URL", () => {
  it("hay archivos .astro publicos que revisar", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ningun href/src interno literal (sin BASE_URL) en paginas publicas", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(LITERAL_INTERNAL)) {
        offenders.push(`${file.replace(`${root}/`, "")}: ${match[0]}`);
      }
    }
    expect(
      offenders,
      `Enlaces/assets internos sin BASE_URL (404 en subpath):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
