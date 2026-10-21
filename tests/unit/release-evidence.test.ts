import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const evidence = JSON.parse(readFileSync(join(root, "docs/testing/release-evidence.json"), "utf8"));
const STATUSES = new Set(["passed", "partial", "blocked_unverified", "not_run", "pending", "failed"]);
const FORBIDDEN_SECRET_FIELDS = ["apiKey", "api_key", "token", "authorization", "secret", "password"];

function walk(value: unknown, path = "$"): string[] {
  if (!value || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SECRET_FIELDS.includes(key)) found.push(`${path}.${key}`);
    found.push(...walk(child, `${path}.${key}`));
  }
  return found;
}

function rows(): any[] {
  return [...evidence.requiredEvidence, ...evidence.guarantees];
}

describe("C41 release evidence registry", () => {
  it("uses the expected format and candidate scope", () => {
    expect(evidence.format).toBe("portaless-release-evidence-v1");
    expect(evidence.version).toBe("1.0");
    expect(evidence.candidateIncludes).toEqual(["C40", "C41"]);
    expect(evidence.summary.unitFiles).toBeGreaterThan(0);
    expect(evidence.summary.unitTests).toBeGreaterThan(0);
    expect(evidence.summary.playwrightTests).toBeGreaterThan(0);
  });

  it("covers every required release evidence item", () => {
    const ids = evidence.requiredEvidence.map((row: any) => row.id);
    expect(ids).toEqual([
      "lockfile-install",
      "build-normal",
      "build-base-portaless",
      "node-runtime",
      "d1-representative",
      "publication-unpublication",
      "private-leak-negative",
      "historical-upgrade-restore",
      "chatgpt-external",
      "openai-compatible-local",
      "openai-compatible-external",
      "resource-budget",
      "independent-review",
    ]);
  });

  it("never marks evidence as passed without an evidence path", () => {
    for (const row of rows()) {
      expect(STATUSES.has(row.status), `${row.id}: invalid status ${row.status}`).toBe(true);
      if (row.status !== "passed") continue;
      const value = row.evidence;
      if (Array.isArray(value)) {
        expect(value.length, `${row.id}: empty evidence`).toBeGreaterThan(0);
        for (const entry of value) expect(typeof entry).toBe("string");
      } else {
        expect(typeof value, `${row.id}: missing evidence`).toBe("string");
        expect(value.length, `${row.id}: empty evidence`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps external ChatGPT, API, Cloudum and real GitHub as open gates", () => {
    expect(evidence.external.chatgptCustomMcp.status).toBe("blocked_unverified");
    expect(evidence.external.openAiCompatibleProvider.status).toBe("not_run");
    expect(evidence.external.cloudum.status).toBe("not_run");
    expect(evidence.external.realGithubAccount.status).toBe("not_run");
    expect(evidence.external.independentHumanReview.status).toBe("pending");
  });

  it("does not claim page-level reputation or Cloudum equivalence", () => {
    const reputation = evidence.guarantees.find((row: any) => row.id === "reputation-belongs-to-revision");
    const cloudum = evidence.guarantees.find((row: any) => row.id === "local-and-cloudum-equivalent");
    expect(reputation.status).toBe("partial");
    expect(cloudum.status).toBe("partial");
  });

  it("contains no credential fields", () => {
    expect(walk(evidence)).toEqual([]);
  });

  it("links the release evidence from the official entry points", () => {
    for (const file of ["README.md", "ROADMAP.md", "docs/README.md"]) {
      expect(readFileSync(join(root, file), "utf8"), file).toContain("release-acceptance.md");
    }
  });
});
