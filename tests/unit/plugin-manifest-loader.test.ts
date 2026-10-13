// LocalManifestSource (plugin-sandbox) — 0% de cobertura. Filtra
// manifiestos invalidos con validateManifest y sigue con los validos
// (un manifiesto malo no tumbar la carga completa del registro).

import { describe, it, expect, vi, afterEach } from "vitest";
import { LocalManifestSource } from "../../packages/plugin-sandbox/src/manifest/manifest-loader";
import type { PluginManifest } from "../../packages/plugin-sandbox/src/types";

function validManifest(name: string): PluginManifest {
  return {
    name,
    version: "1.0.0",
    description: "ok",
    entry: "plugin.js",
    permissions: [],
    requestedCapabilities: [],
    network: { allowedHosts: [] },
    limits: { cpuMs: 1000, memoryMb: 128 },
  } as unknown as PluginManifest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocalManifestSource", () => {
  it("devuelve solo los manifiestos validos y descarta los invalidos sin lanzar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = new LocalManifestSource([
      validManifest("bueno"),
      { name: "", version: "" } as unknown as PluginManifest,
    ]);
    const all = await source.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("bueno");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("lista vacia devuelve lista vacia", async () => {
    const source = new LocalManifestSource([]);
    expect(await source.loadAll()).toEqual([]);
  });

  it("todos validos -> todos pasan; todos invalidos -> lista vacia con aviso por cada uno", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await new LocalManifestSource([validManifest("a"), validManifest("b")]).loadAll();
    expect(ok).toHaveLength(2);

    const bad = await new LocalManifestSource([
      { nope: 1 } as unknown as PluginManifest,
      { name: "x" } as unknown as PluginManifest,
    ]).loadAll();
    expect(bad).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
