// Barrido del sitio ESTATICO construido con la BASE de produccion
// (PORTALESS_BASE_PATH=/portaless/). Es el test que faltaba: los tests de rutas
// miraban el modulo o el runtime, pero nadie construia con la base real y
// recorria dist/ resolviendo cada enlace. Habria atrapado, de una sola vez:
//   1. las tarjetas de Explore apuntando a /pages// (choque de firmas),
//   2. los stubs de /paginas/<slug>/ perdiendo el base,
//   3. los stubs relativos de /en/<x>/ con la profundidad mal (auto-bucle),
//   4. el slug de docs renombrado,
//   5. cualquier ruta legada que reaparezca en el HTML servido.
//
// Construye a un outDir temporal (no pisa dist/, que usa Playwright) y luego:
//   - falla si algun href o meta-refresh apunta a una ruta LEGADA;
//   - resuelve cada enlace INTERNO (con base) a un archivo de dist y falla si no
//     existe (0 enlaces rotos);
//   - resuelve cada meta-refresh RELATIVO desde la ubicacion del propio archivo
//     y falla si apunta a si mismo o a un archivo inexistente.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const BASE = "/portaless/";
const OUT = "dist-sweep";
const distDir = join(root, OUT);

const LEGACY = /(^|\/)\/(paginas|tienda|proyecciones)(?=[/"'`)\s.:;,]|$)/;
const SKIP_PREFIXES = ["/.well-known/", "/api/", "/admin", "/images/", "/healthz"];
const EXTERNAL = /^(https?:|mailto:|tel:|#|data:|javascript:|\/\/)/;

interface Page {
  file: string;
  urlPath: string; // /portaless/...
  html: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const p = join(dir, entry);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

/** Ruta publica de un archivo de dist (respeta el base). */
function urlPathOf(file: string): string {
  let rel = "/" + relative(distDir, file).split("\\").join("/");
  if (rel.endsWith("/index.html")) rel = rel.slice(0, -"index.html".length);
  return `${BASE.replace(/\/$/, "")}${rel}`;
}

/** Resuelve una ruta publica a un archivo de dist (dir -> index.html). */
function resolveAsset(path: string): string | null {
  let local = path.split("#")[0].split("?")[0];
  if (!local.startsWith(BASE.replace(/\/$/, "") + "/") && local !== BASE.replace(/\/$/, "")) return null;
  local = local.slice(BASE.replace(/\/$/, "").length) || "/";
  const candidates = [
    join(distDir, local),
    join(distDir, local, "index.html"),
    join(distDir, `${local}.html`),
  ];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

function metaUrls(html: string): string[] {
  return [...html.matchAll(/http-equiv="refresh"\s+content="0;url=([^"]*)"/gi)].map((m) => m[1]);
}

let pages: Page[] = [];

beforeAll(() => {
  // ENV LIMPIO a proposito: vitest/Vite exporta `BASE_URL=/` y el build hijo lo
  // heredaria pisando el base del config (import.meta.env.BASE_URL lo toma de
  // ahi). Con el env minimo, el build usa PORTALESS_BASE_PATH de verdad.
  execFileSync("npm", ["run", "build"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORTALESS_BASE_PATH: BASE,
      PORTALESS_OUT_DIR: OUT,
    },
    stdio: "pipe",
  });
  pages = walk(distDir)
    .filter((f) => f.endsWith(".html"))
    .map((file) => ({ file, urlPath: urlPathOf(file), html: readFileSync(file, "utf8") }));
}, 120_000);

afterAll(() => rmSync(distDir, { recursive: true, force: true }));

describe("barrido del estatico con base /portaless/", () => {
  it("el build con base produjo paginas", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it("ninguna pagina servida nombra una ruta legada (href o meta-refresh)", () => {
    const offenders: string[] = [];
    for (const page of pages) {
      for (const href of [...hrefs(page.html), ...metaUrls(page.html)]) {
        if (LEGACY.test(href)) offenders.push(`${page.urlPath} -> ${href}`);
      }
    }
    expect(offenders, `rutas legadas servidas:\n${offenders.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("no hay enlaces internos rotos (0 enlaces, con el base real)", () => {
    const broken: string[] = [];
    const baseNoSlash = BASE.replace(/\/$/, "");
    for (const page of pages) {
      for (const href of hrefs(page.html)) {
        if (EXTERNAL.test(href)) continue;
        if (!href.startsWith(baseNoSlash)) continue;
        // rutas dinamicas (las sirve functions/ en runtime; en estatico el 404
        // lo ignora el navegador -- p.ej. la hoja /api/site-skin).
        const local = href.slice(baseNoSlash.length) || "/";
        if (SKIP_PREFIXES.some((p) => local.startsWith(p))) continue;
        if (!resolveAsset(href)) broken.push(`${page.urlPath} -> ${href}`);
      }
    }
    expect([...new Set(broken)], `enlaces internos rotos:\n${broken.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("cada meta-refresh RELATIVO resuelve desde su propia ubicacion (sin auto-bucle)", () => {
    const offenders: string[] = [];
    for (const page of pages) {
      for (const target of metaUrls(page.html)) {
        if (EXTERNAL.test(target)) continue; // absoluto con base o externo: lo cubre el check de enlaces
        const resolved = new URL(target, `https://x${page.urlPath}`).pathname;
        if (resolved === page.urlPath) offenders.push(`${page.urlPath}: se redirige a si misma (${target})`);
        else if (!resolveAsset(resolved)) offenders.push(`${page.urlPath} -> ${target} (${resolved} no existe)`);
      }
    }
    expect(offenders, `meta-refresh relativo mal resuelto:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("el JSON-LD de las paginas de contenido lleva el base", () => {
    const offenders: string[] = [];
    const baseNoSlash = BASE.replace(/\/$/, "");
    for (const page of pages) {
      const m = page.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (!m) continue;
      const ld = JSON.parse(m[1]);
      const graph = (ld["@graph"] ?? []) as Array<Record<string, unknown>>;
      for (const item of graph) {
        for (const value of [item.url, item["@id"]].filter(Boolean) as string[]) {
          if (!value.startsWith("https://")) continue;
          const path = new URL(value).pathname;
          // Toda URL del propio sitio en el @graph debe estar bajo el base.
          if (path !== baseNoSlash && !path.startsWith(`${baseNoSlash}/`)) {
            offenders.push(`${page.urlPath}: ${value}`);
          }
        }
      }
    }
    expect([...new Set(offenders)], `JSON-LD sin base:\n${offenders.slice(0, 10).join("\n")}`).toEqual([]);
  });

  it("las tarjetas de Explore apuntan a /portaless/pages/<slug>/ (no a /pages//)", () => {
    for (const path of ["/portaless/explore/", "/portaless/es/explore/"]) {
      const page = pages.find((p) => p.urlPath === path);
      expect(page, path).toBeTruthy();
      const cards = hrefs(page!.html).filter((h) => h.includes("/pages/") || h.includes("/paginas"));
      expect(cards.length, path).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c, `${path} -> ${c}`).toMatch(/^\/portaless\/pages\/[a-z0-9-]+\/$/);
      }
    }
  });
});
