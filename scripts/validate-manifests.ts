#!/usr/bin/env node
// Valida todos los manifest.json del monorepo contra validateManifest()
// de @portaless/plugin-sandbox -- reemplaza el placeholder de echo que
// tenia .github/workflows/ci.yml (hallazgo de "Quality Theater": un
// check verde que no validaba absolutamente nada, ver auditoria del
// ci.yml, item 9 del roadmap de esta sesion).
//
// Se ejecuta con `npx tsx scripts/validate-manifests.ts` (ver ci.yml) --
// TypeScript directo, sin paso de build previo, para poder correr lo
// antes posible en el pipeline independientemente del orden de build.
// tsx se agrega a devDependencies en package.json para que la version
// sea determinista (no depende de una instalacion global).
//
// Busca manifest.json en las 2 ubicaciones que ya documenta
// plugins-registry/README.md y el propio ci.yml:
//   - plugins-registry/**/manifest.json  (catalogo publico de plugins)
//   - packages/*/manifest.json           (plugins de referencia del monorepo, ej. hello-plugin)
//
// Usa la MISMA funcion real que ya consumen sandbox-runtime.ts y
// manifest-loader.ts en produccion -- validateManifest(manifest):
// { valid: boolean, errors: string[] } -- para que este script nunca
// pueda divergir silenciosamente de la logica de validacion real.
//
// Exit code 1 si CUALQUIER manifest.json es invalido o si el JSON esta
// mal formado -- eso es lo que hace que este step del CI deje de ser un
// echo cosmetico y empiece a bloquear el job de verdad.

import { readFileSync, existsSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../packages/plugin-sandbox/src/manifest/manifest-schema";
import type { PluginManifest } from "../packages/plugin-sandbox/src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SEARCH_PATTERNS = ["plugins-registry/**/manifest.json", "packages/*/manifest.json"];

async function findManifestFiles(): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of SEARCH_PATTERNS) {
    for await (const match of glob(pattern, { cwd: repoRoot })) {
      found.add(path.join(repoRoot, match));
    }
  }
  return [...found].sort();
}

async function main(): Promise<void> {
  const manifestFiles = await findManifestFiles();

  if (manifestFiles.length === 0) {
    console.log(
      "[validate-manifests] No se encontro ningun manifest.json en plugins-registry/ ni packages/*/manifest.json. " +
        "Nada que validar -- esto no es un error (el catalogo puede estar vacio), pero revisa los patrones de " +
        "busqueda en scripts/validate-manifests.ts si esperabas encontrar alguno."
    );
    process.exit(0);
  }

  console.log(`[validate-manifests] Validando ${manifestFiles.length} manifest.json encontrados:\n`);

  let hasErrors = false;

  for (const filePath of manifestFiles) {
    const relativePath = path.relative(repoRoot, filePath);

    if (!existsSync(filePath)) {
      console.error(`  x ${relativePath}: el archivo desaparecio durante la ejecucion.`);
      hasErrors = true;
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(`  x ${relativePath}: no se pudo leer el archivo -- ${(err as Error).message}`);
      hasErrors = true;
      continue;
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(raw) as PluginManifest;
    } catch (err) {
      console.error(`  x ${relativePath}: JSON invalido -- ${(err as Error).message}`);
      hasErrors = true;
      continue;
    }

    const result = validateManifest(manifest);

    if (result.valid) {
      console.log(`  OK ${relativePath}`);
    } else {
      console.error(`  x ${relativePath}: manifiesto invalido --`);
      for (const error of result.errors) {
        console.error(`      - ${error}`);
      }
      hasErrors = true;
    }
  }

  console.log("");

  if (hasErrors) {
    console.error("[validate-manifests] Uno o mas manifiestos fallaron la validacion. Ver detalles arriba.");
    process.exit(1);
  }

  console.log("[validate-manifests] Todos los manifiestos son validos.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[validate-manifests] Error inesperado:", err);
  process.exit(1);
});
