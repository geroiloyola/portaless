#!/usr/bin/env node
// make-db-snapshot -- crea una base SQLite representativa del checkout ACTUAL
// (schema + datos minimos) para el test de upgrade.
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
  rmSync(out, { force: true });

  const { applySchema } = await import("./setup.mjs");
  await applySchema(out, { quiet: true });

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
  db.close();

  console.log(`[snapshot] ${out}`);
}

main().catch((error) => {
  console.error(`[snapshot] ERROR: ${error?.message ?? error}`);
  process.exit(1);
});
