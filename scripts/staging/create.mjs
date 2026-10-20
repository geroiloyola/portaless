#!/usr/bin/env node
// Levanta un Portaless Node runtime con fixture sintetica y efimera. Solo
// escucha en 127.0.0.1 y usa servicios fake de webhook/SMTP. SIGINT/SIGTERM
// cierran el runtime, cierran los fakes y destruyen su propio staging.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableStaging, destroyDisposableStagingSync } from "./disposable-staging.mjs";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
let fixture;
let server;
let stopping = false;
let startupComplete = false;
let signalRequested = false;

process.on("exit", () => {
  if (!fixture?.id) return;
  try { destroyDisposableStagingSync({ id: fixture.id, rootDir: fixture.rootDir }); } catch { /* recovery command remains available */ }
});

async function stop() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
  if (fixture) await fixture.close();
}

async function main() {
  if (!existsSync(join(rootDir, "dist", "index.html"))) {
    throw new Error("Falta dist/. Ejecuta npm run build antes de crear el staging runtime.");
  }
  fixture = await createDisposableStaging();
  if (signalRequested) {
    await stop();
    return;
  }
  const { createSelfHostServer } = await import(join(rootDir, "server/node-runtime.mjs"));
  server = await createSelfHostServer({
    rootDir,
    functionsDir: join(rootDir, "functions"),
    staticDir: join(rootDir, "dist"),
    env: fixture.env,
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  startupComplete = true;
  if (signalRequested) {
    await stop();
    return;
  }
  const address = server.address();
  console.log(JSON.stringify({
    stagingId: fixture.id,
    url: `http://127.0.0.1:${address.port}`,
    dataDir: fixture.stageDir,
    fakeWebhook: fixture.services.webhookUrl,
    fakeSmtpHost: "127.0.0.1",
    fakeSmtpPort: fixture.services.smtpPort,
    note: "Solo datos y credenciales sinteticas; SIGINT/SIGTERM destruyen esta fixture.",
  }, null, 2));
}

const onSignal = () => {
  signalRequested = true;
  if (!startupComplete) return;
  void stop().catch((e) => { console.error(e.message); process.exitCode = 1; });
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

main().catch(async (error) => {
  console.error(`[staging:create] ${error?.message ?? error}`);
  try { await stop(); } catch (cleanupError) { console.error(`[staging:create] cleanup failed: ${cleanupError.message}`); }
  process.exitCode = 1;
});
