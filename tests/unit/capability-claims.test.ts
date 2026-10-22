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
  "docs/plugin-author-guide.md",
  "docs/architecture/ecosystem-boundaries.md",
  "packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md",
  "src/content/home.json",
  "src/content/home.es.json",
];

function countFromSource() {
  const backends = capabilityBackends();
  return [...PLUGIN_CAPABILITY_IDS].filter((id) => !backends.has(id)).length;
}

describe("plugin capability backends: published claims", () => {
  it("dispatches the exact 12 plugin capability catalog", () => {
    expect([...PLUGIN_CAPABILITY_IDS]).toHaveLength(12);
    expect(countFromSource()).toBe(6);
  });

  it("publishes that count to the live docs and home copy", () => {
    const bad = [];
    for (const doc of docs) {
      const content = readFileSync(join(root, doc), "utf8");
      const wrongNumbers = [
        /five of twelve/i,
        /five capability backends/i,
        /\b7\/12 capability backends\b/,
        /\b5 of 12 capabilities\b/,
      ];
      for (const pattern of wrongNumbers) {
        if (pattern.test(content)) bad.push(`${doc}: ${pattern}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
