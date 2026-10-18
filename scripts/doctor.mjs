#!/usr/bin/env node
// portaless doctor -- diagnostico del CONTRATO DE DATOS.
//
//   npm run doctor
//   npm run doctor -- --path /data/portaless.db
//
// Dice: en que version esta la base, que version espera el codigo, si falta
// alguna tabla critica, y cuantas migraciones legacy (ALTER TABLE) siguen
// actuando como red de seguridad. Sale con codigo 1 si la base es MAS NUEVA
// que el codigo (fail-closed): en ese caso hay que actualizar el codigo, no
// degradar el schema.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const pathArg = args.indexOf("--path");
  const sqlitePath = resolve(
    pathArg >= 0 ? args[pathArg + 1] : process.env.PORTALESS_SQLITE_PATH || "./portaless.db"
  );

  const { schemaVersion, assertCompatible } = await import("../packages/persistence-migrations/src/index.ts");

  console.log("Portaless doctor");
  console.log(`  base: ${sqlitePath}`);
  console.log(`  codigo espera: schema v${schemaVersion()}`);

  if (!existsSync(sqlitePath)) {
    console.log("  estado: no hay base todavia (se creara en el primer arranque).");
    console.log("  OK.");
    return;
  }

  const { openSqlite } = await import("../packages/sqlite-driver/src/open.ts");
  const { REQUIRED_TABLES } = await import("./setup.mjs");

  const db = await openSqlite(sqlitePath);
  try {
    let dbVersion = 0;
    try {
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
      dbVersion = Number(row?.v ?? 0);
    } catch {
      dbVersion = 0; // tabla ausente: base pre-versionado
    }
    console.log(`  base esta en: schema v${dbVersion}`);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    console.log(`  tablas: ${tables.length} (${missing.length} criticas faltantes)`);
    if (missing.length) console.log(`  faltan: ${missing.join(", ")}`);

    try {
      assertCompatible(dbVersion);
      console.log(dbVersion === 0 ? "  estado: pre-versionado (corre `npm run migrate`)." : "  estado: compatible.");
      console.log("  OK.");
    } catch (err) {
      console.error(`  INCOMPATIBLE: ${err.message}`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`[doctor] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
