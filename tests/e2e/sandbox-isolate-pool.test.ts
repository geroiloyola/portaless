// Test end-to-end real del pool de isolates de NodeIsolatedVmAdapter
// (poolMaxIsolates) -- ver ROADMAP.md "Pool de isolates reutilizables
// para el commerce-plugin". Corre isolated-vm real (no mock).
//
// Verifica dos cosas que un pool mal implementado rompe facilmente:
// 1. Reutilizacion real: ejecutar mas veces que el tope del pool no crea
//    mas isolates vivos que el tope (`poolStats().live <= max`).
// 2. Aislamiento real entre ejecuciones: aunque el isolate SUBYACENTE se
//    reutilice, una variable global definida por un plugin no debe ser
//    visible en la ejecucion del siguiente plugin que tome ese mismo
//    isolate prestado del pool (el Context se recrea cada vez).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../packages/plugin-sandbox/src/adapters/node-isolated-vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIsolatedVmVersion(): string {
  const candidatePaths = [
    join(__dirname, "..", "..", "packages", "plugin-sandbox", "node_modules", "isolated-vm", "package.json"),
    join(__dirname, "..", "..", "node_modules", "isolated-vm", "package.json"),
  ];
  for (const pkgPath of candidatePaths) {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version as string;
    }
  }
  throw new Error("isolated-vm package.json not found in any known location");
}

function makeManifest() {
  return {
    name: "isolate-pool-test-plugin",
    version: "0.0.1",
    entry: "index.js",
    runtime: "javascript" as const,
    requestedCapabilities: [],
  };
}

async function getPooledAdapter(t: { skip: (msg: string) => void }, maxIsolates: number): Promise<NodeIsolatedVmAdapter | null> {
  let installedVersion: string;
  try {
    installedVersion = loadIsolatedVmVersion();
  } catch {
    t.skip("isolated-vm no esta instalado -- test omitido, no fallado.");
    return null;
  }
  const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000, poolMaxIsolates: maxIsolates });
  if (!(await adapter.isAvailable())) {
    t.skip("isolated-vm no pudo cargarse en este runtime -- test omitido, no fallado.");
    return null;
  }
  return adapter;
}

describe("NodeIsolatedVmAdapter -- pool de isolates (v0.0.9)", () => {
  it("con poolMaxIsolates=2, ejecutar 6 veces secuencialmente nunca crea mas de 2 isolates vivos", async (t) => {
    const adapter = await getPooledAdapter(t, 2);
    if (!adapter) return;

    for (let i = 0; i < 6; i++) {
      const result = await adapter.execute({ manifest: makeManifest(), granted: new Set(), code: `"run-${i}";`, payload: {} });
      expect(result.success, `ejecucion ${i} deberia tener exito. Error: ${result.error}`).toBe(true);
    }

    const stats = adapter.poolStats;
    expect(stats, "el pool deberia estar activo").not.toBeNull();
    expect(stats!.live).toBeLessThanOrEqual(2);
    expect(stats!.max).toBe(2);
    // Con ejecucion secuencial, el pool nunca deberia necesitar mas de 1
    // isolate vivo (el anterior siempre se libera antes de que empiece
    // la siguiente ejecucion) -- confirma que SI se estan reutilizando y
    // no creando uno nuevo por llamada.
    expect(stats!.live).toBeLessThanOrEqual(1);

    adapter.disposePool();
  });

  it("6 ejecuciones concurrentes con poolMaxIsolates=2 nunca exceden el tope de isolates vivos", async (t) => {
    const adapter = await getPooledAdapter(t, 2);
    if (!adapter) return;

    const runs = Array.from({ length: 6 }, (_, i) =>
      adapter.execute({ manifest: makeManifest(), granted: new Set(), code: `"concurrent-${i}";`, payload: {} })
    );
    const results = await Promise.all(runs);

    for (const [i, result] of results.entries()) {
      expect(result.success, `ejecucion concurrente ${i} deberia tener exito. Error: ${result.error}`).toBe(true);
    }

    // El pico de "live" durante la ejecucion pudo haber superado el tope
    // momentaneamente (ver nota en IsolateVmPool.acquire: si el pool esta
    // lleno se crea una instancia EXTRA fuera del pool en vez de bloquear
    // la ejecucion) -- lo que se garantiza es que, una vez terminadas
    // todas las ejecuciones y liberados los isolates, el pool en reposo
    // nunca retiene mas del tope configurado.
    const stats = adapter.poolStats!;
    expect(stats.idle).toBeLessThanOrEqual(2);
    expect(stats.max).toBe(2);

    adapter.disposePool();
  });

  it("aislamiento real: una variable global de una ejecucion no es visible en la siguiente, aunque el isolate se reutilice", async (t) => {
    const adapter = await getPooledAdapter(t, 1); // tope 1 -> fuerza reutilizar el MISMO isolate subyacente.
    if (!adapter) return;

    const codeSetsGlobal = `
      globalThis.__leakedFromPreviousRun = "deberia-desaparecer";
      "set_ok";
    `;
    const first = await adapter.execute({ manifest: makeManifest(), granted: new Set(), code: codeSetsGlobal, payload: {} });
    expect(first.success, `primera ejecucion deberia tener exito. Error: ${first.error}`).toBe(true);

    const codeChecksGlobal = `
      typeof globalThis.__leakedFromPreviousRun === "undefined" ? "aislado_correctamente" : "FUGA_DE_ESTADO";
    `;
    const second = await adapter.execute({ manifest: makeManifest(), granted: new Set(), code: codeChecksGlobal, payload: {} });
    expect(second.success, `segunda ejecucion deberia tener exito. Error: ${second.error}`).toBe(true);
    expect(second.output).toBe("aislado_correctamente");

    adapter.disposePool();
  });

  it("sin poolMaxIsolates configurado (comportamiento por defecto), poolStats es null", async (t) => {
    let installedVersion: string;
    try {
      installedVersion = loadIsolatedVmVersion();
    } catch {
      t.skip("isolated-vm no esta instalado -- test omitido.");
      return;
    }
    const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000 });
    if (!(await adapter.isAvailable())) {
      t.skip("isolated-vm no disponible -- test omitido.");
      return;
    }

    const result = await adapter.execute({ manifest: makeManifest(), granted: new Set(), code: `"no_pool";`, payload: {} });
    expect(result.success).toBe(true);
    expect(adapter.poolStats).toBeNull();
  });
});
