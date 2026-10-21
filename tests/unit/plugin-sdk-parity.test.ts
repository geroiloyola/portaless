// Anti-drift: el SDK (MIT) re-declara su catalogo y su validacion como
// documento propio -- NO importa el core (AGPL) en runtime. Esta prueba vive
// del lado AGPL y garantiza que la copia no diverja: compara DATOS (deep-equal)
// y comportamiento, no solo la forma del tipo.
import { describe, it, expect } from "vitest";
import * as sdk from "../../packages/plugin-sdk/src/index";
import {
  capabilityRegistry as coreRegistry,
  listCapabilitiesByCategory as coreList,
  listCapabilitiesByRisk as coreListByRisk,
  RISK_ORDER as CORE_RISK_ORDER,
  RISK_LABELS as CORE_RISK_LABELS,
} from "../../packages/plugin-sandbox/src/capabilities/capability-registry";
import { validateManifest as coreValidate } from "../../packages/plugin-sandbox/src/manifest/manifest-schema";
import {
  CORE_VERSION,
  isEngineCompatible as coreIsEngineCompatible,
} from "../../packages/plugin-sandbox/src/manifest/manifest-schema";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_MANIFEST_TYP as CORE_PLUGIN_MANIFEST_TYP } from "../../packages/apw-resolver/src/did-apw/plugin-manifest";
import type { PluginManifest } from "../../packages/plugin-sandbox/src/types";

const manifests: PluginManifest[] = [
  { name: "ok", version: "1.0.0", entry: "index.js", requestedCapabilities: [], runtime: "javascript" },
  {
    name: "ok2",
    version: "1.0.0",
    entry: "index.js",
    requestedCapabilities: [{ id: "content:read", reason: "lee paginas del sitio" }],
    runtime: "javascript",
  },
  {
    name: "net-ok",
    version: "1.0.0",
    entry: "index.js",
    requestedCapabilities: [{ id: "network:fetch", allowedHosts: ["api.example.com"], reason: "consulta la API" }],
    runtime: "javascript",
  },
  {
    name: "net-bad",
    version: "1.0.0",
    entry: "index.js",
    requestedCapabilities: [{ id: "network:fetch", reason: "sin hosts declarados" }],
    runtime: "javascript",
  },
  {
    name: "unknown",
    version: "1.0.0",
    entry: "index.js",
    requestedCapabilities: [{ id: "does:not-exist" as never, reason: "capacidad inventada" }],
    runtime: "javascript",
  },
  {
    name: "bypass",
    version: "1.0.0",
    entry: "index.js",
    requestedCapabilities: [{ id: "trust:read-governance-bypass", reason: "no es de plugins" }],
    runtime: "javascript",
  },
  { name: "", version: "1.0.0", entry: "", requestedCapabilities: [], runtime: "javascript" },
  { name: "no-caps", version: "1.0.0", entry: "index.js", requestedCapabilities: undefined as never, runtime: "javascript" },
];

describe("plugin-sdk <-> plugin-sandbox: paridad", () => {
  it("el catalogo de capacidades es identico (deep-equal)", () => {
    expect(sdk.capabilityRegistry).toEqual(coreRegistry);
  });

  it("la agrupacion por categoria es identica", () => {
    expect(sdk.listCapabilitiesByCategory()).toEqual(coreList());
  });

  it("la agrupacion por riesgo y su orden son identicas", () => {
    expect(sdk.listCapabilitiesByRisk()).toEqual(coreListByRisk());
    expect(sdk.RISK_ORDER).toEqual(CORE_RISK_ORDER);
    expect(sdk.RISK_LABELS).toEqual(CORE_RISK_LABELS);
  });

  it("PLUGIN_CAPABILITY_IDS excluye las capacidades reservadas/MCP", () => {
    const expected = Object.keys(coreRegistry)
      .filter((id) => !["billing:pay-per-crawl", "trust:read-governance-bypass", "content:publish", "mcp:private-context:read"].includes(id))
      .sort();
    expect([...sdk.PLUGIN_CAPABILITY_IDS].sort()).toEqual(expected);
  });

  it("validateManifest da el mismo veredicto y los mismos errores", () => {
    for (const m of manifests) {
      expect(sdk.validateManifest(m), JSON.stringify(m)).toEqual(coreValidate(m));
    }
  });

  it("PLUGIN_MANIFEST_TYP coincide con el typ del core (ERRATA E-15)", () => {
    expect(sdk.PLUGIN_MANIFEST_TYP).toBe(CORE_PLUGIN_MANIFEST_TYP);
    expect(sdk.PLUGIN_MANIFEST_TYP).toBe("apw-plugin-manifest+jws");
  });

  it("isEngineCompatible da el mismo veredicto en SDK y core", () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "0.0.11"],
      ["", "0.0.11"],
      ["^0.0.11", "0.0.11"],
      ["^0.0.9", "0.0.11"],
      ["^1.0.0", "0.0.11"],
      ["~0.0.11", "0.0.11"],
      [">=0.0.5", "0.0.11"],
      ["<=0.0.11", "0.0.11"],
      ["0.0.11", "0.0.11"],
      [">1.0.0", "0.0.11"],
      ["^0.0.1 || ^0.0.11", "0.0.11"],
      ["no-es-un-rango", "0.0.11"],
    ];
    for (const [range, version] of cases) {
      expect(sdk.isEngineCompatible(range, version), `${range} @ ${version}`).toBe(
        coreIsEngineCompatible(range, version),
      );
    }
    // y el veredicto esperado (fail-closed en sintaxis desconocida)
    expect(coreIsEngineCompatible("no-es-un-rango", "0.0.11")).toBe(false);
    expect(coreIsEngineCompatible(undefined, "0.0.11")).toBe(true);
  });

  it("CORE_VERSION sigue a package.json (no deriva en silencio)", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
    expect(CORE_VERSION).toBe(pkg.version);
  });
});
