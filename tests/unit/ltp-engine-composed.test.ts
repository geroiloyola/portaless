import { describe, expect, test } from "vitest";
import canonicalize from "canonicalize";
import { runComposed } from "../../packages/ltp-engine/src/composed";
import { ResourceBudget, LtpFailure } from "../../packages/ltp-engine/src/budget";
import { canonicalBytes, digestBytes, digestJcs, isCanonicalPayload } from "../../packages/ltp-engine/src/canonical";
import { jwkThumbprint, jwsDigest, parseCompactJws, verifyEd25519 } from "../../packages/ltp-engine/src/jws";
import { verifyHandoff } from "../../packages/ltp-engine/src/verification";
import type { ProofPackage } from "../../packages/ltp-engine/src/types";
import { FakeClock, ReplayTransport, loadCase, scriptedClock } from "../fixtures/ltp-v03";

const ids = ["AB-STATIC-01", "AB-STATIC-02", "AB-STATIC-03", "AB-STATIC-04", "AB-STATIC-05", "AB-STATIC-06", "AB-STATIC-07"];

async function run(id: string) {
  const bank = loadCase(id);
  const clock = new FakeClock(0);
  const transport = new ReplayTransport(bank, clock);
  const verification = scriptedClock(bank.fixture.resourceFacts.verificationTimeline.map(entry => entry.elapsedMs));
  const outcome = await runComposed({
    subject: bank.subject(),
    requestId: bank.requestId(),
    bootstrapProfile: "independent-doh-ad-v1",
    config: bank.config(),
    policy: bank.policy(),
    transport,
    now: clock.now,
    verificationNow: verification,
    wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
    operationId: bank.initialState().context.operationId,
    clientScope: bank.initialState().context.clientScope,
    states: { initial: bank.initialState(), slices: bank.slices() },
    wallAt: bank.verificationWall,
  });
  return { bank, clock, transport, outcome };
}

describe("composed A→B static corpus", () => {
  for (const id of ids) {
    test(`${id} matches its literal expected result without reading the expected object`, async () => {
      const { bank, outcome } = await run(id);
      expect(outcome.result).toEqual(bank.fixture.expected);
    });
  }

  test("the master handoff is byte-for-byte the frozen producer handoff", async () => {
    const { bank, outcome } = await run("AB-STATIC-01");
    const expected = bank.handoff();
    expect(outcome.handoff).not.toBeNull();
    const handoff = outcome.handoff!;
    expect(handoff.subject).toBe(expected.subject);
    expect(handoff.requestId).toBe(expected.requestId);
    expect(handoff.packageDigest).toBe(expected.packageDigest);
    expect(digestBytes(handoff.packageBytes)).toBe(expected.packageDigest);
    expect(handoff.targetManifestDigest).toBe(expected.targetManifestDigest);
    expect(handoff.keySetDigest).toBe(expected.keySetDigest);
    expect(handoff.elapsedAtHandoffMs).toBe(expected.elapsedAtHandoffMs);
    expect(handoff.remainingAtHandoffMs).toBe(expected.remainingAtHandoffMs);
    expect(handoff.context).toEqual(expected.context);
    expect(handoff.root).toEqual(expected.root);
    expect(outcome.budget.httpAttemptsUsed).toBe(2);
    expect(outcome.budget.bodyBytesUsed).toBe(4781);
    expect(outcome.budget.signatureAttemptsUsed).toBe(5);
  });

  test("AB-STATIC-02 stops at the DoH root and never sends the package request", async () => {
    const { transport, outcome } = await run("AB-STATIC-02");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].stage).toBe("A-DOH");
    expect(outcome.result.acquisitionConsumed).toEqual([true, false]);
    expect(outcome.result.signatureAttemptsConsumed).toBe(0);
  });

  test("an outer digest cannot hide a mutated inner log signature, even after repairing local prefix hashes", async () => {
    const { bank, outcome } = await run("AB-STATIC-01");
    const pkg = JSON.parse(Buffer.from(outcome.handoff!.packageBytes).toString("utf8")) as ProofPackage;
    const history = pkg.histories[0];
    const compact = history.entries[1].jws.split(".");
    const signature = compact[2].split("");
    signature[10] = signature[10] === "A" ? "B" : "A";
    compact[2] = signature.join("");
    history.entries[1].jws = compact.join(".");
    const repairedHash = jwsDigest(history.entries[1].jws);
    const { id: _oldId, ...historyCore } = history;
    history.id = digestJcs(historyCore);
    pkg.identities[0].historyRef = history.id;
    const states = structuredClone(bank.slices());
    states[1].output.hash = repairedHash;
    states[2].input.hash = repairedHash;
    const tampered = {
      ...outcome.handoff!,
      packageBytes: canonicalBytes(pkg),
      packageDigest: digestJcs(pkg),
    };
    const verify = verifyHandoff({
      handoff: tampered,
      budget: new ResourceBudget(bank.limits(), () => 0),
      policy: bank.policy(),
      states: { initial: bank.initialState(), slices: states },
      now: scriptedClock([300, 800, 1300]),
      wallAt: bank.verificationWall,
    });
    expect(verify.result.reason).toBe("bad_signature");
    expect(verify.result.stopsBefore).toBe("B-LOG-3");
    expect(verify.result.logSlicesConsumed).toEqual([true, true, false]);
    expect(verify.result.signatureAttemptsConsumed).toBe(4);
  });

  test("recomputing the outer digest still fails when the package no longer matches the signed handoff target", async () => {
    const { bank, outcome } = await run("AB-STATIC-01");
    const pkg = JSON.parse(Buffer.from(outcome.handoff!.packageBytes).toString("utf8")) as ProofPackage;
    pkg.histories[0].entries[0].jws = pkg.histories[0].entries[0].jws.replace(/.$/, "A");
    const tampered = { ...outcome.handoff!, packageBytes: canonicalBytes(pkg), packageDigest: digestJcs(pkg) };
    const verify = verifyHandoff({
      handoff: tampered,
      budget: new ResourceBudget(bank.limits(), () => 0),
      policy: bank.policy(),
      states: { initial: bank.initialState(), slices: bank.slices() },
      now: scriptedClock([300, 800]),
      wallAt: bank.verificationWall,
    });
    expect(verify.ok).toBe(false);
    expect(["bad_signature", "proof_mismatch"]).toContain(verify.result.reason);
  });
});

describe("G2 budget and primitive checks", () => {
  test("the shared deadline is exclusive and cannot reset", () => {
    let now = 99;
    const budget = new ResourceBudget({ bodyBytes: 10, dohBytes: 10, packageBytes: 10, signatureAttempts: 1, httpAttempts: 1, deadlineMs: 100 }, () => now);
    budget.checkDeadline("ok");
    now = 100;
    expect(() => budget.checkDeadline("late")).toThrowError(LtpFailure);
    expect(() => budget.checkDeadline("late")).toThrowError(/deadline/);
  });

  test("http attempts, body bytes and signature attempts fail closed", () => {
    const budget = new ResourceBudget({ bodyBytes: 8, dohBytes: 8, packageBytes: 8, signatureAttempts: 1, httpAttempts: 1, deadlineMs: 100 }, () => 0);
    const reserve = budget.reserveHttp(8, "A-DOH");
    reserve.settle(8);
    expect(() => budget.reserveHttp(1, "A-PACKAGE")).toThrowError(/http attempt/);
    expect(() => budget.reserveHttp(1, "A-PACKAGE")).toThrowError(/http attempt/);
    const budget2 = new ResourceBudget({ bodyBytes: 8, dohBytes: 8, packageBytes: 8, signatureAttempts: 1, httpAttempts: 2, deadlineMs: 100 }, () => 0);
    budget2.reserveSignature("x");
    expect(() => budget2.reserveSignature("x")).toThrowError(/signature attempt/);
  });

  test("a failed attempt keeps the pre-charged byte reservation and a success refunds only the unused part", () => {
    const limits = { bodyBytes: 100, dohBytes: 10, packageBytes: 10, signatureAttempts: 1, httpAttempts: 2, deadlineMs: 100 };
    const failed = new ResourceBudget(limits, () => 0);
    failed.reserveHttp(10, "A-DOH");
    expect(failed.bodyBytesUsed).toBe(10);
    expect(failed.httpAttemptsUsed).toBe(1);
    const completed = new ResourceBudget(limits, () => 0);
    completed.reserveHttp(10, "A-DOH").settle(4);
    expect(completed.bodyBytesUsed).toBe(4);
    expect(completed.httpAttemptsUsed).toBe(1);
  });

  test("a response above its pre-reserved cap is rejected", () => {
    const budget = new ResourceBudget({ bodyBytes: 100, dohBytes: 8, packageBytes: 8, signatureAttempts: 1, httpAttempts: 1, deadlineMs: 100 }, () => 0);
    const reserve = budget.reserveHttp(8, "A-DOH");
    expect(() => reserve.settle(9)).toThrowError(/cap/);
  });

  test("the fixture manifest verifies with its EdDSA key and rejects a one-byte mutation", () => {
    const bank = loadCase("AB-STATIC-01");
    const pkg = JSON.parse(Buffer.from(bank.handoff().packageBytes).toString("utf8")) as ProofPackage;
    const identity = pkg.identities[0];
    const jws = parseCompactJws(identity.manifestJws)!;
    const jwk = identity.didDocument.verificationMethod[0].publicKeyJwk;
    expect(verifyEd25519(jwk, jws)).toBe(true);
    expect(jwkThumbprint(jwk)).toBe(bank.rootManifest().k);
    const mutated = { ...jws, signature: Uint8Array.from(jws.signature) };
    mutated.signature[0] ^= 1;
    expect(verifyEd25519(jwk, mutated)).toBe(false);
  });

  test("non-JCS payload bytes are not accepted as canonical", () => {
    expect(isCanonicalPayload(new TextEncoder().encode('{"b":1,"a":2}'))).toBe(false);
    expect(isCanonicalPayload(new TextEncoder().encode('{"a":2,"b":1}'))).toBe(true);
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
});
