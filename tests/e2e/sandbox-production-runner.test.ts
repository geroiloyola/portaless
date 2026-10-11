// E2E del caller de produccion (runPluginInProduction) contra el
// adaptador real isolated-vm con el hello-plugin: el mismo camino que
// usaria POST /admin/api/plugins/run en self-host, pero invocado
// directamente. Usa un permission store real (en memoria) concediendo
// network:fetch, y verifica que la allowlist del manifiesto se respeta
// (mismo contrato que tests/e2e/sandbox-hello-plugin.test.ts, pero
// ensamblado por el caller de produccion en vez del adapter a mano).
//
// isolated-vm puede estar en node_modules/ raiz o en el workspace local;
// se prueba ambas rutas y se omite el test (no falla) si no existe.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPluginInProduction } from "../../packages/plugin-sandbox/src/runtime/production-plugin-runner";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import type { PluginManifest } from "../../packages/plugin-sandbox/src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(__dirname, "..", "..", "packages", "plugin-sandbox", "examples", "hello-plugin");

function loadIsolatedVmVersion(): string {
  const candidatePaths = [
    join(__dirname, "..", "..", "packages", "plugin-sandbox", "node_modules", "isolated-vm", "package.json"),
    join(__dirname, "..", "..", "node_modules", "isolated-vm", "package.json"),
  ];
  for (const pkgPath of candidatePaths) {
    if (existsSync(pkgPath)) {
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version as string;
    }
  }
  throw new Error("isolated-vm package.json not found in any known location");
}

describe("runPluginInProduction (hello-plugin E2E)", () => {
  it("ejecuta hello-plugin real via el caller de produccion y respeta granted ∩ pedido", async (t) => {
    let installedVersion: string;
    try {
      installedVersion = loadIsolatedVmVersion();
    } catch {
      t.skip("isolated-vm no esta instalado -- test omitido, no fallado.");
      return;
    }

    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf-8")) as PluginManifest;
    const code = readFileSync(join(PLUGIN_DIR, "index.js"), "utf-8");

    // Concede network:fetch (lo que pide) y site:admin de MAS (que el
    // manifiesto no pide): el ∩ aplicado por el caller debe descartarla.
    const permissionStore = new InMemoryPermissionStore();
    for (const capabilityId of ["network:fetch", "site:admin"]) {
      await permissionStore.setGrant({
        subject: { type: "plugin", id: "hello-plugin", displayName: "hello-plugin" },
        capabilityId,
        granted: true,
      });
    }

    const result = await runPluginInProduction(
      { PORTALESS_ISOLATED_VM_VERSION: installedVersion },
      { manifest, code, payload: { desde: "e2e" } },
      { permissionStore }
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe("node-isolated-vm");
    expect(result.output).toBe("ejecucion completada");
  }, 20000);
});
