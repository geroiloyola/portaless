// Barrido del sitio ESTATICO construido con la BASE de produccion
// (PORTALESS_BASE_PATH=/portaless/) en AMBOS perfiles:
//   - demo: todas las paginas demo, docs, ES, beta, shop, projections y redirects
//   - starter: perfil limpio por defecto, sin demo/docs/ES/beta/shop/projections
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const BASE = "/portaless/";
const OUT_DEMO = "dist-sweep-demo";
const OUT_STARTER = "dist-sweep-starter";
const distDemo = join(root, OUT_DEMO);
const distStarter = join(root, OUT_STARTER);

const LEGACY = /(^|\/)\/(paginas|tienda|proyecciones)(?=[/"'`)\s.:;,]|$)/;
const SKIP_PREFIXES = ["/.well-known/", "/api/", "/admin", "/images/", "/healthz"];
const EXTERNAL = /^(https?:|mailto:|tel:|#|data:|javascript:|\/\/)/;

interface Page {
  file: string;
  urlPath: string;
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

function urlPathOf(distDir: string, file: string): string {
  let rel = "/" + relative(distDir, file).split("\\").join("/");
  if (rel.endsWith("/index.html")) rel = rel.slice(0, -"index.html".length);
  return `${BASE.replace(/\/$/, "")}${rel}`;
}

function resolveAsset(distDir: string, targetPath: string): string | null {
  let local = targetPath.split("#")[0].split("?")[0];
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

function loadPages(distDir: string): Page[] {
  return walk(distDir)
    .filter((f) => f.endsWith(".html"))
    .map((file) => ({ file, urlPath: urlPathOf(distDir, file), html: readFileSync(file, "utf8") }));
}

function assertCleanLinks(distDir: string, pages: Page[]): void {
  const legacyOffenders: string[] = [];
  const broken: string[] = [];
  const metaOffenders: string[] = [];
  const baseNoSlash = BASE.replace(/\/$/, "");

  for (const page of pages) {
    for (const href of [...hrefs(page.html), ...metaUrls(page.html)]) {
      if (LEGACY.test(href)) legacyOffenders.push(`${page.urlPath} -> ${href}`);
    }
    for (const href of hrefs(page.html)) {
      if (EXTERNAL.test(href)) continue;
      if (!href.startsWith(baseNoSlash)) continue;
      const local = href.slice(baseNoSlash.length) || "/";
      if (SKIP_PREFIXES.some((p) => local.startsWith(p))) continue;
      if (!resolveAsset(distDir, href)) broken.push(`${page.urlPath} -> ${href}`);
    }
    for (const target of metaUrls(page.html)) {
      if (EXTERNAL.test(target)) continue;
      const resolved = new URL(target, `https://x${page.urlPath}`).pathname;
      if (resolved === page.urlPath) metaOffenders.push(`${page.urlPath}: se redirige a si misma (${target})`);
      else if (!resolveAsset(distDir, resolved)) metaOffenders.push(`${page.urlPath} -> ${target} (${resolved} no existe)`);
    }
  }

  expect(legacyOffenders, `rutas legadas servidas:\n${legacyOffenders.slice(0, 20).join("\n")}`).toEqual([]);
  expect([...new Set(broken)], `enlaces internos rotos:\n${broken.slice(0, 20).join("\n")}`).toEqual([]);
  expect(metaOffenders, `meta-refresh relativo mal resuelto:\n${metaOffenders.join("\n")}`).toEqual([]);
}

let demoPages: Page[] = [];
let starterPages: Page[] = [];

beforeAll(() => {
  execFileSync("npm", ["run", "build"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORTALESS_BASE_PATH: BASE,
      PORTALESS_OUT_DIR: OUT_DEMO,
      PORTALESS_SITE_PROFILE: "demo",
    },
    stdio: "pipe",
  });
  demoPages = loadPages(distDemo);

  execFileSync("npm", ["run", "build"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORTALESS_BASE_PATH: BASE,
      PORTALESS_OUT_DIR: OUT_STARTER,
    },
    stdio: "pipe",
  });
  starterPages = loadPages(distStarter);
}, 180_000);

afterAll(() => {
  rmSync(distDemo, { recursive: true, force: true });
  rmSync(distStarter, { recursive: true, force: true });
});

describe("barrido del estatico con base /portaless/ (perfil demo)", () => {
  it("el build demo produjo paginas completas y sin enlaces rotos", () => {
    expect(demoPages.length).toBeGreaterThan(50);
    assertCleanLinks(distDemo, demoPages);
  });

  it("el JSON-LD de las paginas de contenido lleva el base", () => {
    const offenders: string[] = [];
    const baseNoSlash = BASE.replace(/\/$/, "");
    for (const page of demoPages) {
      const m = page.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (!m) continue;
      const ld = JSON.parse(m[1]);
      const graph = (ld["@graph"] ?? []) as Array<Record<string, unknown>>;
      for (const item of graph) {
        for (const value of [item.url, item["@id"]].filter(Boolean) as string[]) {
          if (!value.startsWith("https://")) continue;
          const p = new URL(value).pathname;
          if (p !== baseNoSlash && !p.startsWith(`${baseNoSlash}/`)) {
            offenders.push(`${page.urlPath}: ${value}`);
          }
        }
      }
    }
    expect([...new Set(offenders)], `JSON-LD sin base:\n${offenders.slice(0, 10).join("\n")}`).toEqual([]);
  });

  it("las tarjetas de Explore apuntan a /portaless/pages/<slug>/ (no a /pages//)", () => {
    for (const p of ["/portaless/explore/", "/portaless/es/explore/"]) {
      const page = demoPages.find((item) => item.urlPath === p);
      expect(page, p).toBeTruthy();
      const cards = hrefs(page!.html).filter((h) => h.includes("/pages/") || h.includes("/paginas"));
      expect(cards.length, p).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c, `${p} -> ${c}`).toMatch(/^\/portaless\/pages\/[a-z0-9-]+\/$/);
      }
    }
  });
});

describe("barrido del estatico con base /portaless/ (perfil starter por defecto)", () => {
  it("el build starter emite /, exactamente 1 pagina (/pages/starter-guide/), 1 post (/blog/welcome/), 0 rutas demo y 0 assets externos", () => {
    expect(starterPages.length).toBeGreaterThan(20);
    assertCleanLinks(distStarter, starterPages);

    for (const forbidden of ["docs", "es", "beta", "projections", "shop", "tienda", "proyecciones", "en", "avatars", "demo-assets"]) {
      expect(existsSync(join(distStarter, forbidden)), `starter no debe emitir ${forbidden}`).toBe(false);
    }

    // Exactamente 1 pagina bajo /pages/ => /portaless/pages/starter-guide/
    const starterContentPages = starterPages.filter((p) => p.urlPath.startsWith("/portaless/pages/"));
    expect(starterContentPages.map((p) => p.urlPath)).toEqual(["/portaless/pages/starter-guide/"]);

    // Exactamente 1 post bajo /blog/ (ademas del indice /blog/)
    const starterBlogPosts = starterPages.filter(
      (p) => p.urlPath.startsWith("/portaless/blog/") && p.urlPath !== "/portaless/blog/"
    );
    expect(starterBlogPosts.map((p) => p.urlPath)).toEqual(["/portaless/blog/welcome/"]);

    // Home y starter-guide sin imagenes/scripts externos
    for (const urlPath of ["/portaless/", "/portaless/pages/starter-guide/"]) {
      const page = starterPages.find((p) => p.urlPath === urlPath);
      expect(page, urlPath).toBeTruthy();
      expect(page!.html).not.toMatch(/<img[^>]+src="https?:\/\//i);
      expect(page!.html).not.toMatch(/<script[^>]+src="https?:\/\//i);
    }

    // /explore/ en starter usa "Pages" (no "Demo Pages") y enlaza a /portaless/pages/starter-guide/
    const explore = starterPages.find((p) => p.urlPath === "/portaless/explore/");
    expect(explore).toBeTruthy();
    expect(explore!.html).toContain("/portaless/pages/starter-guide/");
    expect(explore!.html).not.toContain("Demo Pages");

    const sitemap = readFileSync(join(distStarter, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("/portaless/blog/welcome/");
    expect(sitemap).toContain("/portaless/pages/starter-guide/");
    expect(sitemap).not.toContain("/docs/");
    expect(sitemap).not.toContain("/es/");
    expect(sitemap).not.toContain("/beta/");
    expect(sitemap).not.toContain("/projections/");
    expect(sitemap).not.toContain("/shop/");

    const llms = readFileSync(join(distStarter, "llms.txt"), "utf8");
    expect(llms).toContain("/portaless/blog/welcome.md");
    expect(llms).not.toContain("/docs/");
  });
});
