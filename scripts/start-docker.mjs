#!/usr/bin/env node
// scripts/start-docker.mjs -- entrypoint self-hosted con primer arranque sin terminal.
//
//   npm run start:self-host   (usa tsx: el servicio importa modulos .ts del repo)
//
// 1. Resuelve PORTALESS_SQLITE_PATH (default /data/portaless.db).
// 2. Prepara secretos, aplica schema.sql y, si no hay usuarios, genera el setup code.
// 3. Inicia el runtime Node inyectando el servicio como env.__PORTALESS_FIRST_RUN.
//
// El Dockerfile y los despliegues de plataforma llegan en PR C.

import { createFirstRunService } from "../server/first-run.mjs";
import { startSelfHostServer } from "../server/node-runtime.mjs";

async function main() {
  const sqlitePath = process.env.PORTALESS_SQLITE_PATH || "/data/portaless.db";
  const baseEnv = { ...process.env, PORTALESS_SQLITE_PATH: sqlitePath };
  const firstRun = createFirstRunService({ env: baseEnv, sqlitePath });
  const { envPatch } = await firstRun.prepare();
  const env = { ...baseEnv, ...envPatch, __PORTALESS_FIRST_RUN: firstRun };
  await startSelfHostServer({ env });
}

main().catch((error) => {
  console.error("No se pudo iniciar Portaless:", error?.message ?? error);
  process.exit(1);
});
