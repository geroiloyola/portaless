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

  const { schemaVersion } = await import("../packages/persistence-migrations/src/index.ts");
  const { migrationStatus } = await import("../packages/persistence-migrations/src/gate.ts");

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
    const status = await migrationStatus({ PORTALESS_SQLITE_PATH: sqlitePath });
    if (!status) {
      console.log("  estado: DB vacía, todavía no hay esquema Portaless.");
      return;
    }
    console.log(`  ledger: ${status.legacy ? "ausente (DB sin versionar)" : `schema v${status.dbVersion}`}`);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    console.log(`  tablas: ${tables.length} (${missing.length} criticas faltantes)`);
    if (missing.length) console.log(`  faltan: ${missing.join(", ")}`);

    const problems = [...status.schemaErrors, ...status.ledgerErrors];
    if (problems.length) console.error(`  contrato incumplido: ${problems.join(", ")}`);
    if (status.newer || status.invalid) {
      console.error(status.newer
        ? `  INCOMPATIBLE: la base está en v${status.dbVersion}, el código espera v${status.codeVersion}.`
        : "  INCOMPATIBLE: el ledger o las columnas no cumplen el contrato.");
      process.exitCode = 1;
    } else if (status.pending) {
      console.log(`  estado: migraciones pendientes (v${status.dbVersion} -> v${status.codeVersion}); corre [1mnpm run migrate[0m.`);
      process.exitCode = 1;
    } else if (status.legacy) {
      console.log("  estado: schema completo verificado; el ledger puede adoptarse con backup vía `npm run migrate`.");
      console.log("  OK (sin ledger todavía).");
    } else {
      console.log("  estado: ledger y esquema compatibles.");
      console.log("  OK.");
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`[doctor] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
