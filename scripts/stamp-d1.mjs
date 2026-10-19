#!/usr/bin/env node
// Estampa el libro mayor `schema_migrations` en una base Cloudflare D1.
//
// Problema (R1): en Cloudflare el operador crea la base con
//   npx wrangler d1 execute <DB> --remote --file=schema.sql
// pero schema.sql NO crea `schema_migrations` (el runner self-host la estampa en
// el arranque). Sin libro, el gate de migraciones no tiene version que leer. El
// gate NO bloquea una base pre-versionada (schema.sql es la forma actual), pero
// conviene estampar para que `doctor`/el gate tengan version real y futuras
// migraciones numeradas se apliquen.
//
// Uso:
//   node node_modules/tsx/dist/cli.mjs scripts/stamp-d1.mjs                 # imprime el SQL
//   node node_modules/tsx/dist/cli.mjs scripts/stamp-d1.mjs --out stamp.sql # lo escribe
//   npx wrangler d1 execute <DB> --remote --file=stamp.sql
//
// Idempotente: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE.

import { writeFileSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  const { MIGRATIONS, schemaVersion } = await import("../packages/persistence-migrations/src/index.ts");

  const now = new Date().toISOString();
  const lines = [
    "-- Portaless -- estampa del libro mayor de migraciones (generado por scripts/stamp-d1.mjs)",
    "-- Idempotente. Correr con: wrangler d1 execute <DB> --remote --file=<este archivo>",
    "CREATE TABLE IF NOT EXISTS schema_migrations (",
    "  version INTEGER PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  applied_at TEXT NOT NULL",
    ");",
  ];
  for (const m of MIGRATIONS) {
    if (m.version > schemaVersion()) continue;
    lines.push(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', '${now}');`
    );
  }
  const sql = lines.join("\n") + "\n";

  if (outPath) {
    writeFileSync(outPath, sql);
    console.log(`[stamp-d1] escrito ${outPath} (schema v${schemaVersion()})`);
  } else {
    process.stdout.write(sql);
  }
}

main().catch((error) => {
  console.error(`[stamp-d1] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
