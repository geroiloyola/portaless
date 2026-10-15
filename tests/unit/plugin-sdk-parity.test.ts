// Anti-drift: el SDK (MIT) re-declara su catalogo y su validacion como
// documento propio -- NO importa el core (AGPL) en runtime. Esta prueba vive
// del lado AGPL y garantiza que la copia no diverja: compara DATOS (deep-equal)
// y comportamiento, no solo la forma del tipo.
import { describe, it, expect } from "vitest";
import * as sdk from "../../packages/plugin-sdk/src/index";
import {
  capabilityRegistry as coreRegistry,
  listCapabilitiesByCategory as coreList,
} from "../../packages/plugin-sandbox/src/capabilities/capability-registry";
import { validateManifest as coreValidate } from "../../packages/plugin-sandbox/src/manifest/manifest-schema";
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

  it("PLUGIN_CAPABILITY_IDS es el catalogo menos las dos capacidades reservadas", () => {
    const expected = Object.keys(coreRegistry)
      .filter((id) => id !== "billing:pay-per-crawl" && id !== "trust:read-governance-bypass")
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
});
