#!/usr/bin/env node
// verify-upgrade -- migra una base de un tag ANTERIOR con el codigo ACTUAL y
// verifica que los datos siguen intactos.
//
//   node node_modules/tsx/dist/cli.mjs scripts/verify-upgrade.mjs /tmp/snap-vX.db
//
// Es la garantia mas fuerte del contrato de datos: no alcanza con que la
// migracion corra, tiene que dejar el sitio ARRANCABLE con lo que ya habia.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg) {
  console.error(`[upgrade] FALLO: ${msg}`);
  process.exit(1);
}

async function main() {
  const dbPath = resolve(process.argv[2] || "");
  if (!dbPath || !existsSync(dbPath)) fail(`no existe la base: ${dbPath || "(sin path)"}`);

  const { migrateSqlite } = await import("../packages/persistence-migrations/src/runner.ts");
  const { schemaVersion, assertCompatible } = await import("../packages/persistence-migrations/src/index.ts");

  const result = await migrateSqlite(dbPath);
  console.log(`[upgrade] migrado: v${result.from} -> v${result.to} (${result.applied.join(", ") || "sin cambios"})`);
  if (result.backupPath) console.log(`[upgrade] backup: ${result.backupPath}`);

  const { openSqlite } = await import("../packages/sqlite-driver/src/open.ts");
  const db = await openSqlite(dbPath);
  try {
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
    const version = Number(row?.v ?? 0);
    assertCompatible(version);
    if (version !== schemaVersion()) fail(`la base quedo en v${version}, se esperaba v${schemaVersion()}`);

    const skin = db.prepare("SELECT tokens_json FROM site_skin WHERE site_id = ?").get("default");
    const accent = skin ? JSON.parse(skin.tokens_json).accent : null;
    if (accent !== "#ff00aa") fail(`el skin no sobrevivio (accent=${JSON.stringify(accent)})`);
  } finally {
    db.close();
  }

  // El sitio arranca con los datos intactos: la pagina sembrada sigue ahi.
  const { createPageStore } = await import("../packages/atomic-elements/src/persistence/store-factory.ts");
  const store = await createPageStore({ PORTALESS_SQLITE_PATH: dbPath });
  const page = await store.load("upgrade-marker");
  if (!page) fail("la pagina sembrada 'upgrade-marker' desaparecio");
  if (page.title !== "Marca de upgrade") fail(`la pagina cambio de titulo: ${page.title}`);

  console.log("[upgrade] OK -- datos intactos, base compatible, sitio arrancable.");
}

main().catch((error) => fail(error?.message ?? error));
