// Servidor para los tests de navegador (Playwright). Lo levanta
// playwright.config.ts via webServer. Ver tests/browser/*.spec.ts.
//
// - Si falta dist/, corre `npm run build` una vez (la primera corrida es
//   mas lenta; despues reutiliza el build).
// - SQLite en test-results/browser-e2e/ (directorio ya ignorado por git),
//   recreado limpio en cada arranque.
// - Siembra: admin (usuario/contrasena constantes de TEST, nunca para
//   produccion) y una identidad did:apw, para que las tres pantallas
//   (/admin/security, /admin/wizard/rotate-identity, wizard paso 4)
//   tengan estado deterministico sin importar el orden de los archivos.
//
// Uso manual: npx tsx scripts/browser-test-server.mjs  (luego abrir
// http://127.0.0.1:4173/admin/login con admin / Browser-Test-Passw0rd!).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BROWSER_TEST_PORT = Number(process.env.PORTALESS_BROWSER_TEST_PORT || 4173);
export const BROWSER_TEST_ADMIN_USER = "admin";
export const BROWSER_TEST_ADMIN_PASSWORD = "Browser-Test-Passw0rd!";
export const BROWSER_TEST_BASE_URL = `http://127.0.0.1:${BROWSER_TEST_PORT}`;

// Clave AES-GCM de TEST unica y descartable (base64 de 32 bytes). El
// store de site_identity la exige para cifrar la clave privada.
const TEST_IDENTITY_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function startBrowserTestServer() {
  if (!existsSync(join(rootDir, "dist", "index.html"))) {
    console.log("[browser-test-server] dist/ ausente -- corriendo npm run build (solo la primera vez)...");
    execFileSync("npm", ["run", "build"], { cwd: rootDir, stdio: "inherit" });
  }

  const dataDir = join(rootDir, "test-results", "browser-e2e");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const sqlitePath = join(dataDir, "portaless.db");

  const { applySchema } = await import(join(rootDir, "scripts/setup.mjs"));
  await applySchema(sqlitePath, { quiet: true });

  const env = {
    PORTALESS_SQLITE_PATH: sqlitePath,
    PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: TEST_IDENTITY_KEY,
  };

  const { createUsersStore } = await import(join(rootDir, "packages/auth/src/store-factory.ts"));
  await (await createUsersStore(env)).createUser(BROWSER_TEST_ADMIN_USER, BROWSER_TEST_ADMIN_PASSWORD, "admin");

  const { createSiteIdentityStore } = await import(join(rootDir, "packages/apw-resolver/src/did-apw/store-factory.ts"));
  const { generateApwDid } = await import(join(rootDir, "packages/apw-resolver/src/did-apw/generate.ts"));
  const identityStore = await createSiteIdentityStore(env);
  const keyPair = await generateApwDid("browser-test.example");
  await identityStore.create("default", keyPair, BROWSER_TEST_ADMIN_USER);

  const { createSelfHostServer } = await import(join(rootDir, "server/node-runtime.mjs"));
  const server = await createSelfHostServer({
    rootDir,
    functionsDir: join(rootDir, "functions"),
    staticDir: join(rootDir, "dist"),
    env,
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(BROWSER_TEST_PORT, "127.0.0.1", ok);
  });
  console.log(`[browser-test-server] listo en ${BROWSER_TEST_BASE_URL} (admin: ${BROWSER_TEST_ADMIN_USER} / ${BROWSER_TEST_ADMIN_PASSWORD})`);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startBrowserTestServer().catch((error) => {
    console.error("[browser-test-server]", error);
    process.exit(1);
  });
}
