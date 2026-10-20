#!/usr/bin/env node
// make-db-snapshot -- crea una base SQLite representativa de un schema histórico
// (schema + datos minimos) para verificar upgrades reales.
//
//   node node_modules/tsx/dist/cli.mjs scripts/make-db-snapshot.mjs /tmp/snap.db
//
// En CI se corre CON EL ARBOL DE UN TAG: `git checkout vX && ... make-db-snapshot
// /tmp/snap-vX.db && git checkout -`. Despues, con HEAD, se migra esa base y se
// verifica que los datos siguen intactos (tests/unit/upgrade + upgrade.yml).

import { rmSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const out = resolve(process.argv[2] || "./upgrade-snapshot.db");
  const targetVersion = Number(process.argv[3] || 1);
  rmSync(out, { force: true });

  const { applySchema } = await import("./setup.mjs");
  await applySchema(out, { quiet: true });
  const { MIGRATIONS, schemaVersion } = await import("../packages/persistence-migrations/src/index.ts");
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > schemaVersion()) {
    throw new Error(`Versión histórica inválida: ${targetVersion}`);
  }

  const { createPageStore } = await import("../packages/atomic-elements/src/persistence/store-factory.ts");
  const store = await createPageStore({ PORTALESS_SQLITE_PATH: out });
  await store.save({
    version: "0.1",
    slug: "upgrade-marker",
    title: "Marca de upgrade",
    description: "Fila sembrada por make-db-snapshot para el test de upgrade.",
    root: [{ id: "h1", type: "Heading", props: { text: "Sobrevivi a la migracion", level: "h1", align: "left" } }],
  });

  // Una fila de skin con un accent reconocible (debe sobrevivir intacta).
  const { openSqlite } = await import("../packages/sqlite-driver/src/open.ts");
  const db = await openSqlite(out);
  db.prepare("INSERT OR REPLACE INTO site_skin (site_id, skin, tokens_json, updated_at) VALUES (?, ?, ?, ?)").run(
    "default",
    "base",
    JSON.stringify({ accent: "#ff00aa" }),
    new Date().toISOString(),
  );

  // Snapshot de la historia elegida: conserva datos, quita los deltas
  // posteriores y deja el ledger exactamente en targetVersion.
  db.exec("DROP INDEX IF EXISTS idx_users_oauth");
  db.exec("DROP INDEX IF EXISTS idx_site_identity_keys_seq");
  db.exec("DROP INDEX IF EXISTS idx_site_trust_agent_jti");
  db.exec("DROP INDEX IF EXISTS idx_site_trust_escrow_jti");
  for (const migration of MIGRATIONS) {
    if (migration.version <= targetVersion) continue;
    for (const { table, column } of migration.addColumns ?? []) {
      const columns = db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((row) => row.name);
      if (columns.includes(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    for (const [table] of Object.entries(migration.createsTables ?? {})) db.exec(`DROP TABLE IF EXISTS ${table}`);
    for (const statement of migration.statements) {
      const created = statement.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
      if (created) db.exec(`DROP TABLE IF EXISTS ${created}`);
    }
  }
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  db.prepare("DELETE FROM schema_migrations WHERE version > ?").run(targetVersion);
  const baseline = MIGRATIONS.find((migration) => migration.version === targetVersion);
  if (!baseline) throw new Error(`No existe la migración histórica ${targetVersion}`);
  db.prepare("INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)")
    .run(targetVersion, baseline.name, new Date().toISOString());
  db.close();

  console.log(`[snapshot] ${out} (schema histórico v${targetVersion})`);
}

main().catch((error) => {
  console.error(`[snapshot] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
