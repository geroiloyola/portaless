import { describe, expect, it } from "vitest";
import { buildSiteSvriDetail } from "./svri";
import { projectTrustView } from "./policy";

const NOW = 1_800_000_000;
const DAY = 86_400;
const recordedAt = new Date(NOW * 1000).toISOString();
const jws = "header.payload.signature";

function communityRow(overrides: Record<string, unknown>) {
  return {
    category: "content_accuracy",
    score: 5,
    iss: "did:apw:emitter.test",
    jti: "community-1",
    iat: NOW,
    votedAt: recordedAt,
    emitterFirstSeenIat: NOW - 8 * DAY,
    attestationJws: jws,
    ...overrides,
  };
}

describe("SVRI evidence diagnostics", () => {
  it("reports emitter_too_new instead of silently dropping an E-13-ineligible attestation", () => {
    const detail = buildSiteSvriDetail({
      siteId: "example.test",
      community: [communityRow({
        iss: "did:apw:new-emitter.test",
        jti: "community-new",
        emitterFirstSeenIat: NOW - 2 * DAY,
      })],
    });

    expect(detail.svri.t3Count).toBe(0);
    expect(detail.excludedEvidence).toContainEqual(expect.objectContaining({
      attestationId: "community-new",
      issuer: "did:apw:new-emitter.test",
      source: "community",
      tier: "T3",
      reason: "emitter_too_new",
    }));
  });

  it("reports insufficient_weight when a category does not reach the E-13 min_weight of 2.0", () => {
    const detail = buildSiteSvriDetail({
      siteId: "example.test",
      community: [
        communityRow({ iss: "did:apw:a.test", jti: "community-a" }),
      ],
    });

    expect(detail.svri.t3Count).toBe(0);
    const excluded = detail.excludedEvidence.filter((item) => item.reason === "insufficient_weight");
    expect(excluded.map((item) => item.attestationId)).toEqual(["community-a"]);
  });

  it("reports dimension_missing for valid evidence whose category has no LTP dimension", () => {
    const detail = buildSiteSvriDetail({
      siteId: "example.test",
      self: [{
        category: "category_without_dimension",
        declaredValue: true,
        attestationJti: "self-unmapped",
        attestationJws: jws,
        declaredBy: "did:apw:example.test",
        declaredAt: recordedAt,
      }],
    });

    expect(detail.excludedEvidence).toContainEqual(expect.objectContaining({
      attestationId: "self-unmapped",
      source: "self",
      tier: "T2",
      reason: "dimension_missing",
    }));
  });

  it("lists required dimensions that have no direct T1/T2 signature", () => {
    const detail = buildSiteSvriDetail({
      siteId: "example.test",
      self: [{
        category: "privacy_policy",
        declaredValue: true,
        attestationJti: "self-privacy",
        attestationJws: jws,
        declaredBy: "did:apw:example.test",
        declaredAt: recordedAt,
      }],
    });

    expect(detail.missingDimensions).toContain("W-01");
    expect(detail.missingDimensions).toContain("W-02");
    expect(detail.missingDimensions).not.toContain("W-04");
  });

  it("feeds projectTrustView from the evidence context, not from the numeric score", () => {
    const detail = buildSiteSvriDetail({
      siteId: "example.test",
      community: [communityRow({
        iss: "did:apw:new-emitter.test",
        jti: "community-new",
        emitterFirstSeenIat: NOW - 2 * DAY,
      })],
    });
    const scores = new Map(detail.dimensions.map((dimension) => [dimension.dimension, dimension]));
    const view = projectTrustView(scores, false, [], detail.evidence);

    expect(view.svri).toEqual({ version: "1.0", publicLevel: "pending" });
    expect(view).not.toHaveProperty("excludedEvidence");
    expect(view).not.toHaveProperty("missingDimensions");
  });
});
