// APW 6.5, ERRATA E-8: excepcion por lector. Un grant
// `trust:read-governance-bypass` del Centro de Permisos sobre el DID de un
// lector salta los umbrales de reputacion; NO salta la identidad (6.3).
import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  validatePolicy,
  DEFAULT_GOVERNED_POLICY,
  type ReaderState,
} from "../../packages/apw-resolver/src/scoring/policy";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import {
  READ_GOVERNANCE_BYPASS_CAPABILITY,
  hasReadGovernanceBypass,
  isReaderDid,
  readerSubject,
  validateReaderGrant,
} from "../../packages/permissions/src/reader-bypass";

const DID = "did:apw:indice.example";

const verified: ReaderState = { kind: "apw_verified", did: DID, scores: new Map() };
const unresolvable: ReaderState = { kind: "apw_unresolvable", did: DID, reason: "reader_conduct_incomplete" };
const wbaOnly: ReaderState = { kind: "wba_only", signatureAgent: "https://indice.example" };

describe("isReaderDid", () => {
  it("acepta solo did:apw:<dominio> sin fragmento ni espacios", () => {
    expect(isReaderDid(DID)).toBe(true);
    expect(isReaderDid("did:apw:a.b.c")).toBe(true);
    expect(isReaderDid("did:apw:")).toBe(false);
    expect(isReaderDid("did:key:z")).toBe(false);
    expect(isReaderDid("did:apw:indice.example#key-1")).toBe(false);
    expect(isReaderDid("did:apw:indice example")).toBe(false);
    expect(isReaderDid(null)).toBe(false);
  });
});

describe("hasReadGovernanceBypass (Centro de Permisos)", () => {
  it("false sin grant, true con grant activo sobre el DID del lector", async () => {
    const store = new InMemoryPermissionStore();
    expect(await hasReadGovernanceBypass(store, DID)).toBe(false);

    await store.setGrant({
      subject: readerSubject(DID),
      capabilityId: READ_GOVERNANCE_BYPASS_CAPABILITY,
      granted: true,
      grantedBy: "admin1",
    });
    expect(await hasReadGovernanceBypass(store, DID)).toBe(true);

    // Revocado: el grant sigue como fila, pero ya no exime.
    await store.setGrant({
      subject: readerSubject(DID),
      capabilityId: READ_GOVERNANCE_BYPASS_CAPABILITY,
      granted: false,
    });
    expect(await hasReadGovernanceBypass(store, DID)).toBe(false);
  });

  it("un grant de otro DID o de otra capacidad no exime", async () => {
    const store = new InMemoryPermissionStore();
    await store.setGrant({
      subject: readerSubject("did:apw:otro.example"),
      capabilityId: READ_GOVERNANCE_BYPASS_CAPABILITY,
      granted: true,
    });
    await store.setGrant({
      subject: readerSubject(DID),
      capabilityId: "site:admin",
      granted: true,
    });
    expect(await hasReadGovernanceBypass(store, DID)).toBe(false);
  });

  it("un store que falla nunca concede (fail-closed del lado del bypass)", async () => {
    const broken = {
      getGrantsFor: async () => {
        throw new Error("db down");
      },
      setGrant: async () => {},
      getAllGrants: async () => [],
    };
    expect(await hasReadGovernanceBypass(broken, DID)).toBe(false);
  });
});

describe("validateReaderGrant", () => {
  it("solo admite trust:read-governance-bypass para subjects reader", () => {
    expect(validateReaderGrant(READ_GOVERNANCE_BYPASS_CAPABILITY)).toBeNull();
    expect(validateReaderGrant("site:admin")).toContain(READ_GOVERNANCE_BYPASS_CAPABILITY);
    expect(validateReaderGrant(undefined)).toContain(READ_GOVERNANCE_BYPASS_CAPABILITY);
  });
});

describe("evaluatePolicy con bypass (6.5)", () => {
  it("sin bypass, un lector verificado sin reputacion no cumple los umbrales", () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, verified)).toMatchObject({
      allow: false,
      status: "403",
      reason: "reputation_insufficient",
      failed: ["R-01", "R-05"],
    });
  });

  it("con bypass, el mismo lector verificado lee aunque no cumpla umbrales", () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, verified, { bypass: true })).toEqual({ allow: true });
  });

  it("el bypass NO salta la identidad: anonymous, wba_only y apw_unresolvable siguen fuera", () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: "anonymous" }, { bypass: true })).toMatchObject({
      allow: false,
      status: "401",
    });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, wbaOnly, { bypass: true })).toMatchObject({
      allow: false,
      reason: "apw_identity_required",
    });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, unresolvable, { bypass: true })).toMatchObject({
      allow: false,
      reason: "history_unresolvable",
    });
  });

  it("una politica corrupta sigue siendo policy_invalid aunque haya bypass", () => {
    const broken = { ...DEFAULT_GOVERNED_POLICY, require: { identity: "apw_verified", "R-99": { min: 5, min_weight: 2 } } };
    expect(validatePolicy(broken)).toContain("dimension desconocida: R-99");
    expect(evaluatePolicy(broken, verified, { bypass: true })).toMatchObject({
      allow: false,
      status: "403",
      reason: "policy_invalid",
    });
  });

  it("un lector que si cumple los umbrales no necesita el bypass", () => {
    const good: ReaderState = {
      kind: "apw_verified",
      did: DID,
      scores: new Map(
        (["R-01", "R-05"] as const).map((d) => [d, { dimension: d, score: 6.5, count: 3, weightSum: 4 }])
      ),
    };
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, good)).toEqual({ allow: true });
  });
});
