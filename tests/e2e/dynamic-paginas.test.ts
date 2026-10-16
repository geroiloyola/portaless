// Phase 0.5 — close the edit->publish cycle. e2e del runtime self-host:
// /paginas/<slug> se sirve DINAMICAMENTE desde la tabla pages y la base
// gana sobre el build estatico de dist/. Antes de Phase 0.5, una pagina
// editada via editor era invisible hasta correr `npm run publish`; ahora
// guardar -> recargar la URL publica muestra el cambio sin rebuild.
//
// Casos:
//   1. slug SOLO en la base -> 200 con el contenido dinamico;
//   2. slug en la base Y en dist/ (pagina de src/content) -> gana la
//      base (el marcador estatico no aparece);
//   3. slug solo estatico -> next() al build, 200 estatico;
//   4. slug que no existe en ninguna parte -> 404.html con status 404.
//
// El middleware global real (Trust Layer, ledger) no aporta aca: se usa
// un middleware trivial. Las functions reales se reexportan con el
// patron de self-host-first-run.test.ts (shim + import real).

import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

const repo = resolve(__dirname, "../..");
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

// El schema se aplica UNA vez a una plantilla; cada boot() copia el archivo
// (antes, applySchema dentro del test rozaba el timeout de 5s bajo carga).
let TEMPLATE: string;
let templateDir: string;
beforeAll(async () => {
  templateDir = mkdtempSync(join(tmpdir(), "portaless-paginas-e2e-template-"));
  TEMPLATE = join(templateDir, "template.db");
  await applySchema(TEMPLATE, { quiet: true });
});
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

async function listen(server: ReturnType<typeof import("node:http").createServer>) {
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  cleanup.push(() => server.close());
  return base;
}

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "portaless-paginas-e2e-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));

  const functions = join(root, "functions");
  mkdirSync(join(functions, "paginas"), { recursive: true });
  writeFileSync(join(functions, "_middleware.js"), `export async function onRequest(c) { return c.next(); }`);
  writeFileSync(
    join(functions, "paginas", "[slug].js"),
    `export * from ${JSON.stringify(join(repo, "functions/paginas/[slug].js"))};`
  );

  const dist = join(root, "dist");
  mkdirSync(join(dist, "paginas", "estatica"), { recursive: true });
  mkdirSync(join(dist, "paginas", "mi-pagina"), { recursive: true });
  writeFileSync(join(dist, "404.html"), "<h1>NOT-FOUND-ESTATICA</h1>");
  writeFileSync(join(dist, "paginas", "estatica", "index.html"), "<h1>STATIC-ESTATICA-OK</h1>");
  writeFileSync(join(dist, "paginas", "mi-pagina", "index.html"), "<h1>STATIC-MARKER-PISADA</h1>");

  const sqlitePath = join(root, "data", "portaless.db");
  mkdirSync(join(root, "data"), { recursive: true });
  copyFileSync(TEMPLATE, sqlitePath);
  const store = await createPageStore({ PORTALESS_SQLITE_PATH: sqlitePath });
  await store.save({
    version: "0.1",
    slug: "desde-la-base",
    title: "Dinamica E2E",
    root: [{ id: "h1", type: "Heading", props: { text: "Contenido desde la base", level: "h1", align: "center" } }],
  } as unknown as PageLayout);
  await store.save({
    version: "0.1",
    slug: "mi-pagina",
    title: "La Pisada",
    root: [{ id: "p1", type: "Paragraph", props: { text: "Contenido DB gana sobre estatico" } }],
  } as unknown as PageLayout);

  const server = await createSelfHostServer({
    rootDir: root,
    functionsDir: functions,
    staticDir: dist,
    env: { PORTALESS_SQLITE_PATH: sqlitePath },
  });
  const base = await listen(server);
  return { base, sqlitePath };
}

describe("self-host: /paginas/<slug> sirve la base al instante (Phase 0.5)", () => {
  it("DB gana sobre estatico, fallback a dist y 404 estatico", async () => {
    const { base } = await boot();

    // 1. Solo en la base: 200 dinamico con el shell completo.
    const fromDb = await fetch(`${base}/paginas/desde-la-base`);
    expect(fromDb.status).toBe(200);
    expect(fromDb.headers.get("content-type")).toContain("text/html");
    const dbHtml = await fromDb.text();
    expect(dbHtml).toContain("<title>Dinamica E2E</title>");
    expect(dbHtml).toContain("Contenido desde la base");
    expect(dbHtml).toContain('class="ae-page"');
    expect(dbHtml).toContain('href="/api/site-skin"');

    // 2. La base gana sobre el build estatico del mismo slug.
    const overridden = await fetch(`${base}/paginas/mi-pagina`);
    expect(overridden.status).toBe(200);
    const overrideHtml = await overridden.text();
    expect(overrideHtml).toContain("Contenido DB gana sobre estatico");
    expect(overrideHtml).not.toContain("STATIC-MARKER-PISADA");

    // 3. Slug solo estatico: la Function delega con next() al build.
    const staticOnly = await fetch(`${base}/paginas/estatica`);
    expect(staticOnly.status).toBe(200);
    expect(await staticOnly.text()).toContain("STATIC-ESTATICA-OK");

    // 4. Nada en base ni dist: 404.html con status 404 (Cloudflare Pages).
    const missing = await fetch(`${base}/paginas/no-existe-en-lado`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("NOT-FOUND-ESTATICA");
  }, 30_000);

  it("borrar la pagina (DELETE admin) devuelve el fallback estatico", async () => {
    const { base, sqlitePath } = await boot();
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: sqlitePath });

    // Borrado via el mismo camino del page manager: DELETE con la base.
    expect(await store.remove("mi-pagina")).toBe(true);

    const afterDelete = await fetch(`${base}/paginas/mi-pagina`);
    expect(afterDelete.status).toBe(200);
    expect(await afterDelete.text()).toContain("STATIC-MARKER-PISADA");

    // Y el slug que solo vivia en la base ya no tiene render dinamico.
    expect(await store.remove("desde-la-base")).toBe(true);
    const gone = await fetch(`${base}/paginas/desde-la-base`);
    expect(gone.status).toBe(404);
  }, 30_000);
});
