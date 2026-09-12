// Ejecuta: node --experimental-strip-types packages/plugin-sandbox/examples/hello-plugin/run-example.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../src/adapters/node-isolated-vm";
import type { PluginManifest, GrantedCapabilities } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const manifest: PluginManifest = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf-8"));
  const code = readFileSync(join(__dirname, "index.js"), "utf-8");
  const granted: GrantedCapabilities = new Set(["network:fetch"]);
  const adapter = new NodeIsolatedVmAdapter({ installedVersion: "7.0.1" });
  const available = await adapter.isAvailable();
  if (!available) {
    console.error("isolated-vm no esta instalado. npm install isolated-vm --workspace=@portaless/plugin-sandbox");
    process.exit(1);
  }
  const result = await adapter.execute({ manifest, granted, code, payload: { hello: "portaless" } });
  console.log("\n--- Resultado ---");
  console.log(JSON.stringify(result, null, 2));
}

main();
