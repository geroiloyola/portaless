// Runtime real para Playwright, sembrado exclusivamente con la fixture C04.
// DB/archivo privado/servicios fake viven en un directorio temporal unico; no
// se borra una ruta fija del repo ni se monta el home del operador. Se liga a
// loopback y destruye su namespace al recibir SIGINT/SIGTERM.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDisposableStaging,
  destroyDisposableStagingSync,
  STAGING_ADMIN_PASSWORD,
  STAGING_ADMIN_USER,
  STAGING_VIEWER_PASSWORD,
  STAGING_VIEWER_USER,
} from "./staging/disposable-staging.mjs";

export const BROWSER_TEST_PORT = Number(process.env.PORTALESS_BROWSER_TEST_PORT || 4173);
export const BROWSER_TEST_ADMIN_USER = STAGING_ADMIN_USER;
export const BROWSER_TEST_ADMIN_PASSWORD = STAGING_ADMIN_PASSWORD;
export const BROWSER_TEST_VIEWER_USER = STAGING_VIEWER_USER;
export const BROWSER_TEST_VIEWER_PASSWORD = STAGING_VIEWER_PASSWORD;
export const BROWSER_TEST_BASE_URL = `http://127.0.0.1:${BROWSER_TEST_PORT}`;

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
let activeFixtureId;
let activeFixtureRoot;
process.on("exit", () => {
  if (!activeFixtureId) return;
  try { destroyDisposableStagingSync({ id: activeFixtureId, rootDir: activeFixtureRoot }); } catch { /* best-effort; explicit staging:destroy remains available */ }
});

export async function startBrowserTestServer() {
  if (!existsSync(join(rootDir, "dist", "index.html"))) {
    console.log("[browser-test-server] dist/ ausente -- corriendo npm run build...");
    execFileSync("npm", ["run", "build"], { cwd: rootDir, stdio: "inherit" });
  }

  let fixture;
  let server;
  let closing = false;
  let startupComplete = false;
  let signalRequested = false;
  const cleanup = async () => {
    if (closing) return;
    closing = true;
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
    if (fixture) await fixture.close();
    activeFixtureId = undefined;
    activeFixtureRoot = undefined;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = () => {
    signalRequested = true;
    if (!startupComplete) return; // startup observes this flag before returning
    void cleanup().catch((error) => {
      console.error("[browser-test-server] cleanup failed:", error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    fixture = await createDisposableStaging({ rootDir: process.env.PORTALESS_BROWSER_STAGING_ROOT });
    activeFixtureId = fixture.id;
    activeFixtureRoot = fixture.rootDir;
    if (signalRequested) {
      await cleanup();
      return null;
    }

    const { createSelfHostServer } = await import(join(rootDir, "server/node-runtime.mjs"));
    server = await createSelfHostServer({
      rootDir,
      functionsDir: join(rootDir, "functions"),
      staticDir: join(rootDir, "dist"),
      env: fixture.env,
    });
    await new Promise((ok, fail) => {
      server.once("error", fail); // si el puerto pertenece a otro proceso, no lo toca
      server.listen(BROWSER_TEST_PORT, "127.0.0.1", ok);
    });
    startupComplete = true;
    console.log(`[browser-test-server] listo en ${BROWSER_TEST_BASE_URL} (staging id: ${fixture.id}; credenciales sintéticas no impresas)`);
    if (signalRequested) await cleanup();
    return server;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startBrowserTestServer().catch((error) => {
    console.error("[browser-test-server]", error);
    process.exit(1);
  });
}
