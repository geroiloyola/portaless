// Config de los tests de navegador (Playwright). Ver tests/browser/.
// El server lo levanta scripts/browser-test-server.mjs (auto-build si falta
// dist/, SQLite temporal, admin + identidad sembrados). workers: 1 a
// proposito: el server y la base son compartidos y los flujos cambian
// estado (la rotacion de identidad cambia el did; el cambio de contrasena
// cierra sesiones) -- paralelismo aqui seria no-determinista.
import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Namespace por ejecucion, no una carpeta estable dentro del repo. El teardown
// solo borra subdirectorios que llevan el ownership marker de C04.
const BROWSER_TEST_STAGING_ROOT = process.env.PORTALESS_BROWSER_STAGING_ROOT
  ?? join(tmpdir(), `portaless-playwright-${randomBytes(12).toString("hex")}`);
process.env.PORTALESS_BROWSER_STAGING_ROOT = BROWSER_TEST_STAGING_ROOT;
const { BROWSER_TEST_BASE_URL } = await import("./scripts/browser-test-server.mjs");

export default defineConfig({
  testDir: "tests/browser",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalTeardown: "./scripts/staging/playwright-teardown.mjs",
  use: {
    baseURL: BROWSER_TEST_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    // node + la ruta real del CLI de tsx: el shim de node_modules/.bin/tsx
    // no resuelve bien bajo Node 24 (mismo motivo por el que el resto del
    // repo invoca "node node_modules/tsx/dist/cli.mjs ...").
    command: "node node_modules/tsx/dist/cli.mjs scripts/browser-test-server.mjs",
    url: `${BROWSER_TEST_BASE_URL}/admin/login`,
    env: { PORTALESS_BROWSER_STAGING_ROOT: BROWSER_TEST_STAGING_ROOT },
    reuseExistingServer: false,
    timeout: 240_000, // la primera corrida puede incluir npm run build
  },
});
