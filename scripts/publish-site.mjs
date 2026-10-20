#!/usr/bin/env node
// Publica el sitio real: vuelca cada pagina de PageStore a
// src/content/pages/*.json, compila con astro build, y sube el resultado
// (dist/) a un repositorio de GitHub Pages via la Git Data API.
//
// Por que es un script de Node y no un boton del Wizard en el navegador:
// astro build necesita filesystem y child_process reales. Las Cloudflare
// Pages Functions (functions/admin/api/*.js) corren en runtime edge
// (workerd) sin child_process ni build tools -- ahi NO se puede compilar
// el sitio. Mismo patron que scripts/setup.mjs y scripts/onboard-agent.mjs:
// CLI corrida a mano por el admin self-hosted, no un endpoint HTTP.
//
// Uso:
//   npm run publish
//   npm run publish -- --repo=mi-repo-custom

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqlitePageStore } from "../packages/atomic-elements/src/persistence/stores/sqlite-page-store.ts";
import { createDeploymentOAuthStore } from "../packages/deploy-engine/src/oauth-store.ts";
import { readGitHubOAuthConfig, getGitHubAccessToken, GITHUB_PROVIDER } from "../packages/deploy-engine/src/github-oauth.ts";
import { publishStaticSite } from "../packages/deploy-engine/src/github-static-publish.ts";
import { excludeDraftPages, isPubliclyPublishable } from "../packages/deploy-engine/src/draft-filter.ts";
import {
  copyPublicBuildInputs,
  copyPublicDocs,
  copyPublicSourcePages,
  copyPublicSourcePosts,
  createPublicBuildEnv,
  writePublicPageLayouts,
} from "./public-build-stage.mjs";
import { DOC_ENTRIES } from "../src/lib/docs-nav.mjs";
import { projectPublicRevisionHistory } from "../packages/atomic-elements/src/persistence/public-revision-history.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const repoArg = args.find((a) => a.startsWith("--repo="))?.slice("--repo=".length) ?? null;

function walk(dir, distDir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`El build generó un symlink no exportable: ${path.relative(distDir, full)}`);
    if (entry.isDirectory()) walk(full, distDir, out);
    else out.push({ path: path.relative(distDir, full).split(path.sep).join("/"), content: fs.readFileSync(full) });
  }
}

function linkNodeModules(stageRoot) {
  const source = path.join(ROOT, "node_modules");
  if (!fs.existsSync(source)) throw new Error("No existe node_modules/. Ejecuta npm ci antes de publicar.");
  fs.symlinkSync(source, path.join(stageRoot, "node_modules"), "dir");
}

async function main() {
  const sqlitePath = process.env.PORTALESS_SQLITE_PATH;
  if (!sqlitePath) {
    console.error("Falta PORTALESS_SQLITE_PATH. Este script es solo para instalaciones self-hosted con SQLite.");
    process.exit(1);
  }
  const encryptionKey = process.env.PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("Falta PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY.");
    process.exit(1);
  }
  const env = { PORTALESS_SQLITE_PATH: sqlitePath, PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey };

  console.log("1/4 Sincronizando paginas desde PageStore...");
  const pageStore = await SqlitePageStore.open(sqlitePath);
  const allSlugs = await pageStore.list();
  // Cargar los layouts ANTES de filtrar: el publish filter excluye tanto los
  // slug "-draft" (legacy) como los `status: "draft"` nativos, y este ultimo
  // solo se ve en el layout, no en el slug.
  const allLayouts = [];
  for (const slug of allSlugs) {
    const layout = await pageStore.load(slug);
    if (layout) allLayouts.push(layout);
  }
  const { pages: publishable, skipped } = excludeDraftPages(allLayouts);
  const slugs = publishable.map((p) => p.slug);
  if (skipped > 0) {
    console.log(`   Omitiendo ${skipped} pagina(s) privadas, draft o con estado desconocido (politica fail-closed).`);
  }
  if (slugs.length === 0) {
    pageStore.close();
    throw new Error("No hay ninguna pagina publicable en PageStore. Nada que compilar.");
  }
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portaless-public-build-"));
  let files;
  try {
    console.log("2/4 Creando un build publico aislado...");
    copyPublicBuildInputs(ROOT, stageRoot);
    linkNodeModules(stageRoot);
    copyPublicDocs(ROOT, stageRoot, DOC_ENTRIES);
    const databaseOwnedPrivateSlugs = new Set(allLayouts.filter((layout) => !publishable.includes(layout)).map((layout) => layout.slug));
    copyPublicSourcePages(ROOT, stageRoot, databaseOwnedPrivateSlugs, isPubliclyPublishable);
    copyPublicSourcePosts(ROOT, stageRoot, isPubliclyPublishable);
    writePublicPageLayouts(stageRoot, publishable, { clear: false });
    const revisionContentDir = path.join(stageRoot, "src", "content", "revision-history");
    const revisionPublicDir = path.join(stageRoot, "public", "revisions");
    fs.mkdirSync(revisionContentDir, { recursive: true });
    fs.mkdirSync(revisionPublicDir, { recursive: true });
    for (const layout of publishable) {
      if (!layout.publicationId) continue;
      const revisions = await pageStore.listPublicRevisionsByPublicationId?.(layout.publicationId);
      const history = projectPublicRevisionHistory(revisions ?? []);
      if (!history) continue;
      const fileName = `${layout.publicationId}.json`;
      const serialized = JSON.stringify(history, null, 2);
      fs.writeFileSync(path.join(revisionContentDir, fileName), serialized);
      const publicRevisionPath = path.join(revisionPublicDir, layout.publicationId, "index.json");
      fs.mkdirSync(path.dirname(publicRevisionPath), { recursive: true });
      fs.writeFileSync(publicRevisionPath, serialized);
    }
    const distDir = path.join(stageRoot, "dist");
    const buildEnv = createPublicBuildEnv(process.env, distDir);
    execFileSync("npm", ["run", "build"], { cwd: stageRoot, stdio: "inherit", env: buildEnv });
    if (!fs.existsSync(distDir)) throw new Error("El build de Astro no genero dist/.");
    files = [];
    walk(distDir, distDir, files);
    if (files.length === 0) throw new Error("El build publico no genero archivos para publicar.");
    console.log(`   ${slugs.length} pagina(s) publicable(s); ${files.length} artefacto(s) en la proyeccion.`);
  } finally {
    pageStore.close();
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }

  console.log("3/4 Leyendo credenciales de GitHub...");
  const oauthStore = await createDeploymentOAuthStore(env);
  const cfg = await readGitHubOAuthConfig(env, "http://localhost");
  if (!cfg) {
    console.error("GitHub no esta configurado (falta la GitHub App o las env vars). Completa el Paso 2 del Wizard primero.");
    process.exit(1);
  }
  const token = await getGitHubAccessToken(cfg, oauthStore);
  if (!token) {
    console.error("No hay un token de GitHub valido (sin conectar, o vencido sin refresh todavia). Reconecta GitHub desde el Wizard.");
    process.exit(1);
  }
  const cred = await oauthStore.getCredential(GITHUB_PROVIDER);
  const owner = cred?.accountLogin;
  if (!owner) {
    console.error("No se pudo determinar el usuario de GitHub conectado.");
    process.exit(1);
  }
  const repo = repoArg || `${owner}.github.io`;

  console.log(`4/4 Publicando en https://github.com/${owner}/${repo} ...`);
  const result = await publishStaticSite({
    token,
    owner,
    repo,
    files,
    commitMessage: `Publicar sitio (${slugs.length} pagina(s)) via Portaless`,
  });

  console.log("\nListo. Tu sitio quedo publicado en:");
  console.log(`  ${result.pagesUrl}`);
  console.log(`Repositorio: ${result.repoUrl}`);
  console.log("\nRecordatorio: si PORTALESS_SITE_URL no coincide con esa URL, las canonical URLs del SEO quedaran desalineadas.");
}

main().catch((err) => {
  console.error("Error al publicar:", err.message);
  process.exit(1);
});
