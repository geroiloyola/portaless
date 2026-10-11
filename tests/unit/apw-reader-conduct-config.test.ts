import { describe, expect, it } from "vitest";
import {
  READER_CONDUCT_CONFIG,
  conductFor,
  periodKey,
  conductJti,
} from "../../packages/apw-resolver/src/scoring/reader-conduct-config";
import { NEUTRAL, scoreSubject, type ScoredAttestation } from "../../packages/apw-resolver/src/scoring/scoring";
import { DEFAULT_GOVERNED_POLICY, evaluatePolicy } from "../../packages/apw-resolver/src/scoring/policy";
import { toReadPolicy, type ReadPolicyRecord } from "../../packages/apw-resolver/src/scoring/read-policy-store";

// Un test por ajuste: si se cambia un valor, este archivo muestra que cambio.
describe("reader-conduct-config (E-9)", () => {
  it("valores por defecto", () => {
    expect(READER_CONDUCT_CONFIG.emissionPeriod).toBe("month");
    expect(READER_CONDUCT_CONFIG.policyDimensions).toEqual({ "R-01": true, "R-05": false });
    expect(READER_CONDUCT_CONFIG.maxAttestationsLoaded).toBe(200);
    expect(READER_CONDUCT_CONFIG.legacyEntriesWithoutJws).toBe("ignore");
  });

  it("periodKey en UTC: mes, dia y semana ISO", () => {
    const d = new Date("2026-10-03T12:00:00Z");
    expect(periodKey(d, "month")).toBe("2026-10");
    expect(periodKey(d, "day")).toBe("2026-10-03");
    expect(periodKey(d, "week")).toBe("2026-W40");
    expect(periodKey(new Date("2027-01-01T00:00:00Z"), "week")).toBe("2026-W53");
  });

  it("reglas de conducta a partir del ledger", () => {
    expect(conductFor({ requestsTotal: 10, policyViolationsDetected: 0 })).toEqual([{ cat: "respected_policy", val: true }]);
    expect(conductFor({ requestsTotal: 10, policyViolationsDetected: 2 })).toEqual([{ cat: "policy_violation", val: true }]);
    expect(conductFor({ requestsTotal: 0, policyViolationsDetected: 0 })).toEqual([]);
  });

  it("jti determinista por emisor, lector, periodo y categoria", async () => {
    const a = await conductJti("did:apw:a.com", "did:apw:r.com", "2026-10", "respected_policy");
    expect(a).toBe(await conductJti("did:apw:a.com", "did:apw:r.com", "2026-10", "respected_policy"));
    expect(a).not.toBe(await conductJti("did:apw:a.com", "did:apw:r.com", "2026-11", "respected_policy"));
    expect(a).not.toBe(await conductJti("did:apw:a.com", "did:apw:r.com", "2026-10", "policy_violation"));
    expect(a).toMatch(/^rc-[A-Za-z0-9_-]{43}$/);
  });
});

// Por que policyDimensions.R-05 sigue en false: R-05 del sujeto es la
// calibracion de las atestaciones que EL EMITIO (A.4.4, scoreSubject), y un
// lector solo recibe reader_conduct (loadReaderConduct descarta iss === lector).
// Activarlo rechazaria a todos los lectores, no a los malos. Se ancla aqui para
// que nadie lo encienda sin resolver el prerequisito (spec 6.5, ERRATA E-9).
describe("por que R-05 sigue apagada en la politica (E-9)", () => {
  const reader = "did:apw:lector.example";
  // Caso ideal: tres emisores distintos, todos de acuerdo (calibrables entre si).
  const received: ScoredAttestation[] = [0, 1, 2].map((i) => ({
    id: `jti-${i}`,
    iss: `did:apw:sitio${i}.example`,
    sub: reader,
    src: "reader_conduct",
    dimension: "R-01",
    value: 7,
  }));

  const enabledRecord: ReadPolicyRecord = {
    siteId: "sitio.example",
    enabled: true,
    requireApwIdentity: true,
    minR01: 5.0,
    minR01Weight: 2.0,
    minR05: 5.0,
    minR05Weight: 2.0,
    onFail: "403",
    updatedAt: "2026-10-04T00:00:00.000Z",
    updatedBy: "did:apw:sitio.example",
  };

  it("R-01 se gana con emisores calibrables; R-05 queda sin peso", () => {
    const scores = scoreSubject(reader, received);
    expect(scores.get("R-01")).toMatchObject({ score: 5.5, count: 3, weightSum: 3 });
    expect(scores.get("R-05")).toMatchObject({ score: NEUTRAL, count: 0, weightSum: 0 });
  });

  it("con R-05 exigido el mismo lector es 403; con la configuracion por defecto, entra", () => {
    const scores = scoreSubject(reader, received);
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: "apw_verified", did: reader, scores })).toMatchObject({
      allow: false,
      failed: ["R-05"],
    });
    const effective = toReadPolicy(enabledRecord); // R-01 si, R-05 no
    expect(effective).not.toBeNull();
    expect(evaluatePolicy(effective!, { kind: "apw_verified", did: reader, scores })).toEqual({ allow: true });
  });
});
