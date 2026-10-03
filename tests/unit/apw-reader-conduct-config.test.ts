import { describe, expect, it } from "vitest";
import {
  READER_CONDUCT_CONFIG,
  conductFor,
  periodKey,
  conductJti,
} from "../../packages/apw-resolver/src/scoring/reader-conduct-config";

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
