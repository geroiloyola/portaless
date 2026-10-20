import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteSvri, projectSvri } from "../../packages/apw-resolver/src/scoring/svri";
import { runVector } from "../../packages/apw-resolver/conformance/run";

const root = join(__dirname, "../..");
const fixture = JSON.parse(readFileSync(join(root, "docs/protocol-apw/vectors/svri/v1.0/svri-projection.json"), "utf8"));

describe("SVRI v1.0 independent vectors", () => {
  for (const vector of fixture.cases) {
    it(vector.id, () => {
      expect(projectSvri(vector.input)).toMatchObject(vector.expected);
    });
  }

  it("the conformance runner executes and passes the three required SVRI cases", async () => {
    const report = await runVector(fixture);
    const failures = report.results.filter((result) => result.status === "fail");
    expect(failures).toEqual([]);
    expect(report.results.filter((result) => result.status === "unsupported")).toEqual([]);
    const labels = report.results.map((result) => result.label);
    expect(labels).toEqual(expect.arrayContaining([
      "SVRI incompleto",
      "Prior exclusivo",
      "Evidencia degradada",
    ]));
  });

  it("counts only signed source records and never promotes reader conduct into site W", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = buildSiteSvri({
      siteId: "example.test",
      self: [
        { category: "privacy_policy", declaredValue: true, attestationJti: "self-1", attestationJws: "verified-at-ingress" },
        { category: "terms_of_service", declaredValue: false },
      ],
      agent: [
        { category: "structured_data_quality", verified: true, agentKeyId: "https://agent.test", verifiedAt: new Date().toISOString(), attestationJti: "agent-1", attestationJws: "verified-at-ingress" },
        { category: "https_and_headers", verified: true, agentKeyId: "legacy", verifiedAt: new Date().toISOString() },
      ],
      community: [
        { category: "content_accuracy", score: 5, iss: "did:apw:a.test", jti: "community-a", iat: now, votedAt: new Date().toISOString(), emitterFirstSeenIat: now - 8 * 86400, attestationJws: "verified-at-ingress" },
        { category: "content_accuracy", score: 5, iss: "did:apw:b.test", jti: "community-b", iat: now, votedAt: new Date().toISOString(), emitterFirstSeenIat: now - 8 * 86400, attestationJws: "verified-at-ingress" },
        { category: "responsiveness", score: 5, voterId: "legacy-opinion", votedAt: new Date().toISOString() },
      ],
      escrowReports: [
        { transactionOutcome: "completed_as_promised", escrowProvider: "escrow-a", reportedAt: new Date().toISOString(), attestationJti: "escrow-1", attestationJws: "verified-at-ingress" },
      ],
    });
    expect(result).toMatchObject({ t1Count: 1, t2Count: 1, t3Count: 2, t4Count: 0, t5Count: 1, incompleteData: false });
    expect(result.effectiveWeight).toBeGreaterThan(0);
  });
});
