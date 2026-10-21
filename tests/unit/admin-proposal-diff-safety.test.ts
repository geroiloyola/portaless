import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const source = readFileSync(join(root, "src/pages/admin/pages.astro"), "utf8");

describe("admin proposal diff rendering (V1)", () => {
  it("renders the agent proposal as escaped text, never as live HTML", () => {
    expect(source).toContain("diff.textContent = proposal.diff");
    expect(source).toContain("JSON.stringify({ changes: proposal.diff, truncated: proposal.diffTruncated }");
    expect(source).not.toMatch(/innerHTML\s*=\s*[^;]*proposal/i);
    expect(source).not.toMatch(/insertAdjacentHTML\([^)]*proposal/i);
  });

  it("writes proposal metadata with textContent", () => {
    expect(source).toContain("heading.textContent = `${slug} · revisión ${proposal.revisionNo}`");
    expect(source).toContain("meta.textContent = `Base ${proposal.baseRevisionId} · SHA-256 ${proposal.contentHash}`");
  });
});
