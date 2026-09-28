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
//   npm run publish -- --include-drafts
//   npm run publish -- --repo=mi-repo-custom

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqlitePageStore } from "../packages/atomic-elements/src/persistence/stores/sqlite-page-store.ts";
import { createDeploymentOAuthStore } from "../packages/deploy-engine/src/oauth-store.ts";
import { readGitHubOAuthConfig, getGitHubAccessToken, GITHUB_PROVIDER } from "../packages/deploy-engine/src/github-oauth.ts";
import { publishStaticSite } from "../packages/deploy-engine/src/github-static-publish.ts";
import { excludeDrafts } from "../packages/deploy-engine/src/draft-filter.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const includeDrafts = args.includes("--include-drafts");
const repoArg = args.find((a) => a.startsWith("--repo="))?.slice("--repo=".length) ?? null;

function walk(dir, distDir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, distDir, out);
    else out.push({ path: path.relative(distDir, full).split(path.sep).join("/"), content: fs.readFileSync(full) });
  }
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
  const { slugs, skipped } = excludeDrafts(allSlugs, includeDrafts);
  if (skipped > 0) {
    console.log(`   Omitiendo ${skipped} borrador(es) (*-draft). Usa --include-drafts para publicarlos igual.`);
  }
  if (slugs.length === 0) {
    console.error("No hay ninguna pagina publicable en PageStore. Nada que compilar.");
    process.exit(1);
  }
  const contentDir = path.join(ROOT, "src", "content", "pages");
  fs.mkdirSync(contentDir, { recursive: true });
  for (const slug of slugs) {
    const layout = await pageStore.load(slug);
    fs.writeFileSync(path.join(contentDir, `${slug}.json`), JSON.stringify(layout, null, 2));
  }
  console.log(`   ${slugs.length} pagina(s) volcada(s) a src/content/pages/.`);

  console.log("2/4 Compilando el sitio (astro build)...");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

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
  const distDir = path.join(ROOT, "dist");
  if (!fs.existsSync(distDir)) {
    console.error("No existe dist/. El build de astro no genero salida -- revisa el paso anterior.");
    process.exit(1);
  }
  const files = [];
  walk(distDir, distDir, files);

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
