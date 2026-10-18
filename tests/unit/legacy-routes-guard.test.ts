// Guard de la refactorizacion de rutas: /paginas, /tienda y /proyecciones son
// URLs LEGADAS. La unica fuente de las rutas vigentes es src/lib/routes.ts;
// ninguna otra cosa vuelve a escribirlas a mano.
//
// EXCEPCIONES EXPLICITAS (lista viva, se contrae por fase):
//   - CHANGELOG*.md, ROADMAP_es.md, AGENT_es.md, docs/roadmap/ROADMAP-ARCHIVE.md:
//     historial/documentacion de archivo (narran el antes).
//   - src/pages/** legacy durante la Fase 2 y los tests (se actualizan en ese
//     mismo commit): la allowlist los nomina uno a uno; cuando el renombre
//     termina, desaparecen de la lista.
// La palabra "tienda" en prosa en espanol no es una ruta: NO matchea este test.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");

const FORBIDDEN = /(["'`(]|^|\/)\/(?:paginas|tienda|proyecciones)(?=[/"'`)\s.:;,\]\}|$])/g;
const MD = /\.(md|mdx)$/;

// Archivos permitidos, EXPLICITOS (por fase). Todo lo demas con una ruta legada
// es un error.
const ALLOWED = [
  // historial e historico documentado
  "CHANGELOG.md",
  "CHANGELOG_es.md",
  "docs/roadmap/ROADMAP-ARCHIVE.md",
  // el mapa de redirects (narran las URLs legadas: es su trabajo)
  "src/lib/routes.ts",
  "astro.config.mjs",
  "functions/_middleware.js",
  // tests de redirects (cada fila del mapa) y los actualizados en fase 2
  "tests/",
  // contenido demo (sus enlaces internos son URLs legadas: los cubren los
  // redirects de Fase 3, y el usuario decidio NO tocar los campos JSON)
  "src/content/pages/",
  "src/content/home.json",
  "src/content/home.es.json",
];

function isAllowed(rel: string): boolean {
  return ALLOWED.some((a) => rel === a.replace(/\/$/, "") || rel.startsWith(a));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(astro|ts|mjs|js|json|css|html)$/.test(entry) || MD.test(entry)) out.push(p);
  }
  return out;
}

const REL = [
  "src",
  "functions",
  "server",
  "packages",
  "scripts",
  "docs",
  "public",
  "README.md",
  "ROADMAP.md",
  "AGENT.md",
  "AGENTS.md",
  "CHANGELOG.md",
];

const files = REL.flatMap((r) => {
  const p = join(root, r);
  const st = statSync(p);
  return st.isDirectory() ? walk(p) : [p];
});

describe("rutas legadas: solo el mapa de redirects puede nombrarlas", () => {
  it("hay archivos que revisar", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("ninguna ruta legada reaparece fuera de la allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.replace(`${root}/`, "");
      if (isAllowed(rel)) continue;
      const src = readFileSync(file, "utf8");
      FORBIDDEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FORBIDDEN.exec(src))) offenders.push(`${rel}: ...${src.slice(Math.max(0, m.index - 30), m.index + 40).split("\n")[0]}...`);
    }
    expect(offenders, `Rutas legadas fuera del mapa de redirects:\n${offenders.join("\n")}`).toEqual([]);
  });
});
