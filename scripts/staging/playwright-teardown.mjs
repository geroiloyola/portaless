// Teardown de Playwright: recupera una fixture C04 si webServer fue terminado
// antes de completar su SIGTERM cleanup. Solo elimina IDs leidos desde un
// ownership marker valido dentro del namespace aleatorio de ESTA corrida.
import { existsSync } from "node:fs";
import { readdir, readFile, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { destroyDisposableStaging } from "./disposable-staging.mjs";

export default async function globalTeardown() {
  const root = process.env.PORTALESS_BROWSER_STAGING_ROOT;
  if (!root || !existsSync(root)) return;
  const rootReal = resolve(root);
  const entries = await readdir(rootReal, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("stage-")) continue;
    const markerPath = join(rootReal, entry.name, ".portaless-staging-owner.json");
    let marker;
    try { marker = JSON.parse(await readFile(markerPath, "utf8")); }
    catch { throw new Error(`Staging teardown refuses unowned directory: ${entry.name}`); }
    await destroyDisposableStaging({ id: marker.id, rootDir: rootReal });
  }

  // El root solo se quita si queda vacio; nunca se borra contenido ajeno.
  const remaining = await readdir(rootReal);
  if (remaining.length === 0) await rmdir(rootReal);
  else throw new Error(`Staging root retained because it contains non-owned entries: ${rootReal}`);
}
