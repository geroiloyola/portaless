// scripts/capture-screenshots.mjs — Phase 1 (visual evidence of the
// product). Captura screenshots REALES del producto corriendo (no
// mockups) y un GIF corto del ciclo drag -> Publicar -> pagina publica,
// usando el server de browser tests (functions reales + dist real +
// SQLite temporal). Requiere: `npm run build` previo (sirve dist/) y el
// puerto 4173 libre. Salida: docs/screenshots/*.png y editor-publish.gif.
//
// Uso:  npm run build && node node_modules/tsx/dist/cli.mjs scripts/capture-screenshots.mjs
// (tsx solo por consistencia con el resto de scripts; el archivo es ESM
// puro y tambien corre con `node scripts/capture-screenshots.mjs`).
//
// El GIF graba el flujo real en el editor: arrastrar un elemento de la
// paleta al canvas, Publicar, y abrir el link "Ver pagina publica" --
// el mismo ciclo que Phase 0.5 cerro en la UI.

import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { startBrowserTestServer } from "./browser-test-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const { chromium } = await import("@playwright/test");

const GIF_SLUG = "demo-gif";
const VIEWPORT = { width: 1280, height: 800 };

async function login(page, base) {
  await page.goto(`${base}/admin/login`);
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', "Browser-Test-Passw0rd!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/$/);
}

async function shot(page, url, file, { fullPage = false, waitFor } = {}) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  if (waitFor) await waitFor();
  await page.screenshot({ path: join(outDir, file), fullPage });
  console.log(`  [shot] ${file}`);
}

const server = await startBrowserTestServer();
const base = "http://127.0.0.1:4173";
const browser = await chromium.launch();
const videoDir = mkdtempSync(join(tmpdir(), "portaless-gif-"));

try {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  // Sembrar /paginas/link-in-bio en la DB via el mismo PUT del editor
  // (ademas del build estatico) -- el demo y las capturas sirven la
  // pagina desde la base, como en self-host con Phase 0.5.
  await login(page, base);
  const linkInBio = JSON.parse(readFileSync(join(root, "src/content/pages/link-in-bio.json"), "utf8"));
  const putStatus = await page.evaluate(async (json) => {
    const r = await fetch(`/admin/pages/${encodeURIComponent(json.slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(json),
    });
    return r.status;
  }, linkInBio);
  if (putStatus !== 200) throw new Error(`PUT seed /paginas/link-in-bio fallo: HTTP ${putStatus}`);

  console.log("[captura] publicas...");
  await shot(page, `${base}/`, "public-home.png", { fullPage: true });
  await shot(page, `${base}/es/`, "public-home-es.png", { fullPage: true });
  await shot(page, `${base}/paginas/link-in-bio`, "public-link-in-bio.png", { fullPage: true });
  await shot(page, `${base}/blog/`, "public-blog.png", { fullPage: true });
  await shot(page, `${base}/explore/`, "public-explore.png", { fullPage: true });
  await shot(page, `${base}/es/explore/`, "public-explore-es.png", { fullPage: true });
  await shot(page, `${base}/proyecciones/`, "public-proyecciones.png", { fullPage: true });

  console.log("[captura] dashboard / editor / trust...");
  await shot(page, `${base}/admin/`, "admin-dashboard.png", {
    waitFor: async () => {
      // El resumen de riesgo se llena en el navegador contra /admin/permissions.
      await page
        .waitForFunction(() => {
          const el = document.getElementById("ai-risk-desc");
          return el && !el.textContent.includes("Contando");
        }, { timeout: 15_000 })
        .catch(() => {});
    },
  });
  await shot(page, `${base}/admin/permissions`, "admin-permissions.png", {
    waitFor: async () => {
      await page.waitForSelector(".pc-capability", { timeout: 15_000 });
    },
  });
  await shot(page, `${base}/admin/editor?slug=link-in-bio`, "editor-atomic-elements.png", {
    waitFor: async () => {
      await page.waitForSelector(".ae-canvas .ae-block", { timeout: 15_000 });
    },
  });
  await shot(page, `${base}/trust/default`, "trust-score.png", {
    waitFor: async () => {
      await page.waitForSelector("#st-loading", { state: "hidden", timeout: 15_000 });
    },
  });

  // GIF: arrastrar Boton al canvas -> Publicar -> abrir pagina publica.
  console.log("[captura] grabando GIF del ciclo editar->publicar...");
  const gifCtx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const gifPage = await gifCtx.newPage();
  await login(gifPage, base);
  await gifPage.evaluate(async (slug) => {
    await fetch(`/admin/pages/${encodeURIComponent(slug)}`, { method: "DELETE" });
    await fetch(`/admin/pages/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "0.1",
        slug,
        title: "Demo GIF — ciclo editar/publicar",
        root: [
          { id: "h1", type: "Heading", props: { text: "Editor visual de Portaless", level: "h1", align: "center" } },
        ],
      }),
    });
  }, GIF_SLUG);

  await gifPage.goto(`${base}/admin/editor?slug=${GIF_SLUG}`);
  await gifPage.waitForSelector(".ae-palette-item", { timeout: 15_000 });
  await gifPage.waitForTimeout(600); // asentarse
  // Drag real (HTML5) de la paleta al canvas.
  await gifPage.dragAndDrop('.ae-palette-item:has-text("Boton")', ".ae-canvas");
  await gifPage.waitForSelector(".ae-canvas .ae-block", { timeout: 10_000 });
  await gifPage.waitForTimeout(800);
  // Publicar (guarda en la base) y usar el link "Ver pagina publica".
  await gifPage.click("#btn-save");
  await gifPage.waitForSelector("#editor-view-public", { timeout: 10_000 });
  await gifPage.waitForTimeout(700);
  const [publicTab] = await Promise.all([
    gifPage.waitForEvent("popup"),
    gifPage.click("#editor-view-public"),
  ]);
  await publicTab.waitForLoadState("networkidle");
  await publicTab.waitForSelector('a[href="#"]', { timeout: 10_000 });
  await publicTab.waitForTimeout(1200); // cerrar el video con la pagina publica visible
  await publicTab.close();
  const videoPath = await gifPage.video().path();
  // Limpiar la pagina del GIF antes de cerrar su contexto (la page ya no
  // existe despues de gifCtx.close(); el DELETE corre con la sesion del
  // gifPage mientras el contexto sigue vivo).
  await gifPage.evaluate(async (slug) => {
    await fetch(`/admin/pages/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }, GIF_SLUG);
  await gifCtx.close();

  execFileSync("ffmpeg", [
    "-y",
    "-i", videoPath,
    // El flujo real dura ~5s; setpts x2 lo lleva a ~11s (dentro de los
    // 10-15s que pide el ROADMAP) sin cortar pasos.
    "-vf", "setpts=2.0*PTS,fps=10,scale=900:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop", "0",
    join(outDir, "editor-publish.gif"),
  ], { stdio: "pipe" });
  console.log("  [shot] editor-publish.gif");

  await ctx.close();
  await browser.close();
  console.log(`Listo: ${outDir}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
  rmSync(videoDir, { recursive: true, force: true });
}
