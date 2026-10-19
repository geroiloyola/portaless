#!/usr/bin/env node
// Limpieza explicita por ID. No acepta paths; destroyDisposableStagingById
// comprueba formato, hijo directo del staging root y ownership marker.
import { destroyDisposableStagingById } from "./disposable-staging.mjs";

const [id, extra] = process.argv.slice(2);
if (!id || extra) {
  console.error("Uso: npm run staging:destroy -- <staging-id>");
  process.exit(2);
}
try {
  await destroyDisposableStagingById(id);
  console.log(`[staging:destroy] fixture ${id} destruida.`);
} catch (error) {
  console.error(`[staging:destroy] ${error?.message ?? error}`);
  process.exit(1);
}
