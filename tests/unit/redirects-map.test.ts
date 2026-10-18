// Fase 3 -- redirects de una URL legada, POR FILA del mapa (LEGACY_ROUTES en
// src/lib/routes.ts). Dos capas:
//   estatica : el build Astro emite paginas meta-refresh con canonical
//              (dist/paginas/<slug>/index.html) -- lo unico posible en GitHub
//              Pages.
//   runtime  : 301 real en functions/_middleware.js; el mismo middleware corre
//              en self-host (server/node-runtime.mjs), asi que este test arranca
//              el runtime REAL con una dist plantilla de 404 y pega cada fila.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applySchema } from "../../scripts/setup.mjs";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import { loadContentPages } from "../../src/lib/content-pages";
import { LEGACY_ROUTES, resolveLegacyRedirect, ROUTES } from "../../src/lib/routes";

const repo = resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Runtime self-host: una fila por cada caso del mapa.
// ---------------------------------------------------------------------------
const cleanup: Array<() => void> = [];
let TEMPLATE: string;
let templateDir: string;
beforeAll(async () => {
  templateDir = mkdtempSync(join(tmpdir(), "portaless-redirects-"));
  TEMPLATE = join(templateDir, "template.db");
  await applySchema(TEMPLATE, { quiet: true });
});
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "portaless-redirects-run-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));

  // El middleware REAL del repo (con la capa de redirects), en su LUGAR REAL:
  // el runtime hace load() por file y ejecuta el import de TS sin cache; los
  // imports relativos (../packages, ../src) resuelven contra el REPO.
  const functions = join(repo, "functions");

  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "404.html"), "<h1>NOT-FOUND</h1>");
  mkdirSync(join(dist, "pages", "ejemplo-atomic-elements"), { recursive: true });
  writeFileSync(join(dist, "pages", "ejemplo-atomic-elements", "index.html"), "<h1>NEW-OK</h1>");

  const sqlitePath = join(root, "data", "db.sqlite");
  mkdirSync(join(root, "data"), { recursive: true });
  copyFileSync(TEMPLATE, sqlitePath);
  const server = await createSelfHostServer({
    rootDir: root,
    functionsDir: functions,
    staticDir: dist,
    env: { PORTALESS_SQLITE_PATH: sqlitePath },
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  cleanup.push(() => server.close());
  return base;
}

// ---------------------------------------------------------------------------
// Cada fila del mapa: runtime 301 con query preservado.
// ---------------------------------------------------------------------------
const REDIRECT_CASES: Array<{ from: string; to: string }> = [
  { from: "/paginas/jerry-bantz/", to: "/pages/jerry-bantz/" },
  { from: "/es/paginas/bio/", to: "/es/pages/bio/" },
  { from: "/en/paginas/bio/", to: "/pages/bio/" },
  { from: "/tienda/", to: "/es/shop/" },
  { from: "/tienda/polera/", to: "/shop/polera/" },
  { from: "/en/tienda/", to: "/shop/" },
  { from: "/proyecciones/", to: "/es/projections/" },
  { from: "/en/proyecciones/", to: "/projections/" },
  { from: "/en/beta/", to: "/beta/" },
  { from: "/docs/start-in-10-minutes/", to: "/docs/first-steps/" },
  { from: "/docs/primos-pasos.md", to: "/docs/first-steps.md" },
];

describe("redirects runtime self-host (una fila por cada regla del mapa)", () => {
  let base: string;
  beforeAll(async () => { base = await boot(); });
  afterAll(() => { while (cleanup.length) cleanup.pop()!(); });

  for (const { from, to } of REDIRECT_CASES) {
    it(`301: ${from} -> ${to}`, async () => {
      const res = await fetch(`${base}${from}?ref=auditoria`, { redirect: "manual" });
      expect(res.status, `GET ${from}`).toBe(301);
      const location = new URL(res.headers.get("location")!, base);
      expect(location.pathname).toBe(to);
      expect(location.search, "query preservado").toBe("?ref=auditoria");
    });
  }

  it("las rutas nuevas responden 200 (o el contenido estatico que existe)", async () => {
    const res = await fetch(`${base}/pages/ejemplo-atomic-elements/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("NEW-OK");
  });

  it("una ruta desconocida NO se redirige (sin open redirect)", async () => {
    const res = await fetch(`${base}/paginas/../etc`);
    expect(res.status).toBe(404);
    expect((await res.text())).toContain("NOT-FOUND");
  });
});

// ---------------------------------------------------------------------------
// Build estatico: Astro emite las paginas meta-refresh con canonical por cada
// slug de contenido del build.
// ---------------------------------------------------------------------------
describe("redirects estaticos (dist/): meta-refresh con canonical", () => {
  it("las raices del sistema son archivos EMITIDOS en dist/ (URL relativa)", () => {
    for (const case_ of [
      { dir: join(repo, "dist", "tienda"), dest: "../es/shop/" },
      { dir: join(repo, "dist", "en", "tienda"), dest: "../shop/" },
      { dir: join(repo, "dist", "en", "beta"), dest: "../beta/" },
      { dir: join(repo, "dist", "proyecciones"), dest: "../es/projections/" },
      { dir: join(repo, "dist", "en", "proyecciones"), dest: "../projections/" },
    ]) {
      const src = readFileSync(join(case_.dir, "index.html"), "utf8");
      expect(src.toLowerCase()).toContain("http-equiv=\"refresh\"");
      expect(src, case_.dir).toContain(`url=${case_.dest}`);
    }
  });

  it("cada slug de contenido tiene su redireccion emitida", () => {
    for (const page of loadContentPages()) {
      const dir = join(repo, "dist", "paginas", page.slug);
      expect(resolveLegacyRedirect(`/paginas/${page.slug}/`)).toBe(`/pages/${page.slug}/`);
      const src = readFileSync(join(dir, "index.html"), "utf8");
      expect(src.toLowerCase()).toContain("http-equiv=\"refresh\"");
      expect(src.toLowerCase()).toContain(`url=${ROUTES.PAGES}/${page.slug}/`);
    }
  });
});
