import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_BACKENDS } from "../../packages/plugin-sandbox/src/capabilities/capability-backends";
import { PLUGIN_CAPABILITY_IDS } from "../../packages/plugin-sdk/src/index";

const root = join(__dirname, "../..");

function capabilityBackends() {
  return new Set(CAPABILITY_BACKENDS.map((entry: any) => entry.id));
}

const docs = [
  "README.md",
  "AGENT.md",
  "AGENTS.md",
  "ROADMAP.md",
  "docs/plugin-author-guide.md",
  "docs/architecture/ecosystem-boundaries.md",
  "packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md",
  "src/content/home.json",
  "src/content/home.es.json",
];

/**
 * `network:fetch` no pasa por el host bridge: cada adaptador del sandbox la
 * implementa con `fetchAllowed` + allowlist. Contarla como "sin backend"
 * convierte 7 capacidades reales en 6 y publica un 501 que no existe.
 */
function capabilitiesWithoutBackend() {
  const backends = capabilityBackends();
  return [...PLUGIN_CAPABILITY_IDS].filter((id) => id !== "network:fetch" && !backends.has(id));
}

describe("plugin capability backends: published claims", () => {
  it("has 6 non-network host-bridge backends and 5 capabilities still at 501", () => {
    expect([...PLUGIN_CAPABILITY_IDS]).toHaveLength(12);
    expect(capabilityBackends().size).toBe(6);
    expect(capabilitiesWithoutBackend()).toEqual([
      "media:read",
      "media:write",
      "commerce:read",
      "commerce:checkout",
      "site:admin",
    ]);
  });

  it("does not publish the old six/siete counts", () => {
    const stale = [
      /six of twelve plugin capabilities/i,
      /six capability backends/i,
      /remaining six/i,
      /the other six/i,
      /6 de las 12 con bridge devuelven/i,
      /seis de doce/i,
      /6 of 12 capabilities have no backend/i,
    ];
    const bad: string[] = [];
    for (const doc of docs) {
      const content = readFileSync(join(root, doc), "utf8");
      for (const pattern of stale) {
        if (pattern.test(content)) bad.push(`${doc}: ${pattern}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("publishes that five capabilities answer 501, with network:fetch as a real path", () => {
    expect(readFileSync(join(root, "src/content/home.json"), "utf8")).toContain("five of twelve plugin capabilities");
    expect(readFileSync(join(root, "src/content/home.es.json"), "utf8")).toContain("cinco de doce capacidades");
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("five plugin capabilities");
    expect(readFileSync(join(root, "docs/plugin-author-guide.md"), "utf8")).toContain("5 of 12 capabilities");
    expect(readFileSync(join(root, "docs/architecture/ecosystem-boundaries.md"), "utf8")).toContain("7 de las 12");
  });
});
