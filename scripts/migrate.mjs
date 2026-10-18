#!/usr/bin/env node
// portaless migrate -- aplica las migraciones numeradas a la base SQLite.
//
//   npm run migrate              (aplica; hace backup antes)
//   npm run migrate -- --dry-run (dice que haria, sin tocar nada)
//   npm run migrate -- --path /data/portaless.db
//
// Usa tsx (importa modulos .ts del repo). La misma tabla cubre el arranque
// self-host (server/first-run.mjs llama a migrateSqlite antes de servir).

import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const pathArg = args.indexOf("--path");
  const sqlitePath = resolve(
    pathArg >= 0 ? args[pathArg + 1] : process.env.PORTALESS_SQLITE_PATH || "./portaless.db"
  );

  const { migrateSqlite } = await import("../packages/persistence-migrations/src/runner.ts");
  const { schemaVersion } = await import("../packages/persistence-migrations/src/index.ts");

  console.log(`[migrate] base: ${sqlitePath}`);
  console.log(`[migrate] version que espera el codigo: ${schemaVersion()}${dryRun ? " (dry-run)" : ""}`);

  const result = await migrateSqlite(sqlitePath, { dryRun });
  console.log(`[migrate] version actual: ${result.from} -> ${result.to}`);
  if (result.applied.length === 0) {
    console.log("[migrate] al dia, nada que aplicar.");
    return;
  }
  console.log(`[migrate] ${dryRun ? "aplicaria" : "aplico"}: ${result.applied.join(", ")}`);
  if (result.backupPath) console.log(`[migrate] backup: ${result.backupPath}`);
}

main().catch((error) => {
  console.error(`[migrate] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
