import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const evidence = JSON.parse(readFileSync(join(root, "docs/testing/interop-evidence.json"), "utf8"));

const PASSED = "passed";
const STATUSES = new Set(["passed", "blocked_unverified", "not_run", "failed"]);
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
  return [...evidence.mcp, ...evidence.openAiCompatible];
}

describe("C33 interoperability evidence registry", () => {
  it("uses the expected format and required flow", () => {
    expect(evidence.format).toBe("portaless-interop-evidence-v1");
    expect(evidence.version).toBe("1.0");
    expect(evidence.requiredFlow).toEqual([
      "connect",
      "read_authorized_context",
      "edit_block",
      "save_draft",
      "review_diff",
      "approve_exact_revision",
      "read_published_revision",
    ]);
  });

  it("never marks a test as passed without concrete account/client/model/evidence", () => {
    for (const row of rows()) {
      expect(STATUSES.has(row.status), `${row.id}: invalid status ${row.status}`).toBe(true);
      if (row.status !== PASSED) continue;
      for (const field of ["account", "client", "model", "evidence", "executedAt"]) {
        expect(typeof row[field], `${row.id}: passed without ${field}`).toBe("string");
        expect(row[field].length, `${row.id}: empty ${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the external ChatGPT write flow explicitly blocked until a real run", () => {
    const chatgpt = evidence.mcp.find((row: any) => row.id === "chatgpt-custom-mcp");
    expect(chatgpt.status).toBe("blocked_unverified");
    expect(chatgpt.account).toBeNull();
    expect(chatgpt.model).toBeNull();
    expect(chatgpt.reason).toMatch(/No external ChatGPT account/);
    expect(chatgpt.requiredEvidence.length).toBeGreaterThanOrEqual(4);
  });

  it("does not claim an external OpenAI-compatible provider without a real endpoint", () => {
    const external = evidence.openAiCompatible.find((row: any) => row.id === "external-openai-compatible");
    expect(external.status).toBe("not_run");
    expect(external.baseUrl).toBeNull();
    expect(external.reason).toMatch(/real user-supplied API key/);
  });

  it("covers every required flow step for the local MCP pass", () => {
    const local = evidence.mcp.find((row: any) => row.id === "local-mcp-sdk-client");
    expect(local.status).toBe(PASSED);
    for (const step of evidence.requiredFlow) expect(local.flow[step], `missing ${step}`).toBe(true);
  });

  it("contains no credential fields", () => {
    expect(walk(evidence)).toEqual([]);
  });
});
