import canonicalize from "canonicalize";
import { LtpFailure, ResourceBudget } from "./budget";
import { digestJcs, isCanonicalPayload, utf8Text } from "./canonical";
import { jwkThumbprint, jwsDigest, parseCompactJws, verifyEd25519, type ParsedJws } from "./jws";
import { sortPublicKeys } from "./acquisition";
import type {
  ComposedResult,
  DeclaredSlice,
  HistoryProof,
  IdentityProof,
  LtpHandoff,
  LtpLocalReason,
  OperationContext,
  PrefixState,
  ProofPackage,
  PublicKeyRecord,
  TrustPolicy,
} from "./types";

const IDENTITY_PROFILE = "apw-identity-proof-v1";
const HISTORY_TYP = "apw-log+jws";
const MANIFEST_TYP = "apw-manifest+jws";
const KEYSET_TYP = "apw-key-set+jws";

export interface VerificationInput {
  handoff: LtpHandoff;
  budget: ResourceBudget;
  policy: TrustPolicy;
  states: { initial: PrefixState; slices: DeclaredSlice[] };
  /** Injected monotonic clock; the caller supplies the measured boundary values. */
  now: () => number;
  /** Wall clock as a function of elapsed monotonic milliseconds. */
  wallAt?: (elapsedMs: number) => number;
  acquisitionConsumed?: [boolean, boolean];
}

export interface VerificationSuccess {
  ok: true;
  result: ComposedResult;
}

export interface VerificationFailure {
  ok: false;
  result: ComposedResult;
}

export type VerificationOutcome = VerificationSuccess | VerificationFailure;

interface ContextFields {
  operationId: string;
  clientScope: string;
  rootScope: string;
  startedAtMonotonicMs: number;
  deadlineAtMonotonicMs: number;
  httpAttemptsUsed: number;
  bodyBytesUsed: number;
  configDigest: string;
}

const CONTEXT_FIELDS: Array<keyof ContextFields> = [
  "operationId", "clientScope", "rootScope", "startedAtMonotonicMs", "deadlineAtMonotonicMs",
  "httpAttemptsUsed", "bodyBytesUsed", "configDigest",
];

function result(
  reason: LtpLocalReason | null,
  stopsBefore: string | null,
  identity: ComposedResult["identity"],
  history: ComposedResult["history"],
  consumed: [boolean, boolean],
  slices: [boolean, boolean, boolean],
  signatures: number,
  effectiveValidUntil: number | null,
): ComposedResult {
  return {
    identity,
    history,
    proofAccepted: reason === null,
    reason,
    stopsBefore,
    resourceGrant: false,
    reputationAdmitted: false,
    implementationAuthorized: false,
    misconduct: false,
    arbitraryOriginCalls: 0,
    acquisitionConsumed: consumed,
    logSlicesConsumed: slices,
    semanticVerdictObserved: false,
    signatureAttemptsConsumed: signatures,
    effectiveValidUntil,
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8Text(bytes));
  } catch {
    throw new LtpFailure("proof_mismatch", "invalid JSON");
  }
}

function headerString(jws: ParsedJws, field: string): string | null {
  const value = jws.header[field];
  return typeof value === "string" ? value : null;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string") throw new LtpFailure("ts_outside_key_window", "missing entry timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new LtpFailure("ts_outside_key_window", "invalid entry timestamp");
  return parsed;
}

function keyWindow(record: PublicKeyRecord): { from: number; to: number } {
  const from = Date.parse(record.validFrom);
  const to = record.validTo === null ? Number.POSITIVE_INFINITY : Date.parse(record.validTo);
  if (!Number.isFinite(from) || !(Number.isFinite(to) || to === Number.POSITIVE_INFINITY)) {
    throw new LtpFailure("ts_outside_key_window", "invalid key window");
  }
  return { from, to };
}

function currentKey(identity: IdentityProof): { id: string; jwk: JsonWebKey } {
  const methods = identity.didDocument.verificationMethod;
  if (methods.length !== 1) throw new LtpFailure("key_mismatch", "exactly one current DID key is required");
  const method = methods[0];
  if (!method.id.startsWith(`${identity.did}#`) || method.controller !== identity.did) {
    throw new LtpFailure("key_mismatch", "DID method is not controlled by the subject");
  }
  return { id: method.id, jwk: method.publicKeyJwk };
}

function expectedInitial(input: VerificationInput, rootManifestDigest: string, policyDigest: string): PrefixState {
  return {
    did: input.handoff.subject,
    seq: 0,
    hash: null,
    rootManifestDigest,
    targetManifestDigest: input.handoff.targetManifestDigest,
    keySetDigest: input.handoff.keySetDigest,
    trustPolicyDigest: policyDigest,
    context: { ...input.handoff.context, signatureAttemptsUsed: input.budget.signatureAttemptsUsed },
    trustClass: "quarantined-proposal",
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function sameContext(left: OperationContext, right: OperationContext, expectedSignatures: number): boolean {
  for (const field of CONTEXT_FIELDS) if (left[field] !== right[field]) return false;
  return left.policyDigest === right.policyDigest
    && left.signatureAttemptsUsed === expectedSignatures;
}

function sameStateContinuity(left: PrefixState, right: PrefixState, expectedSignatures: number, policyDigest: string): boolean {
  return left.did === right.did
    && left.seq === right.seq
    && left.hash === right.hash
    && left.rootManifestDigest === right.rootManifestDigest
    && left.targetManifestDigest === right.targetManifestDigest
    && left.keySetDigest === right.keySetDigest
    && left.trustPolicyDigest === policyDigest
    && right.trustPolicyDigest === policyDigest
    && left.trustClass === right.trustClass
    && sameContext(left.context, right.context, expectedSignatures)
    && left.context.deadlineAtMonotonicMs === right.context.deadlineAtMonotonicMs;
}

function resolveProof(pkg: ProofPackage, subject: string): { identity: IdentityProof; history: HistoryProof } {
  if (pkg.subject !== subject || pkg.profile !== IDENTITY_PROFILE) {
    throw new LtpFailure("proof_mismatch", "package subject or profile mismatch");
  }
  if (pkg.identities.length !== 1 || pkg.histories.length !== 1) {
    throw new LtpFailure("unsupported_profile", "identity-only package must bind one identity and one history");
  }
  const identity = pkg.identities[0];
  const history = pkg.histories[0];
  if (identity.did !== subject || identity.didDocument.id !== subject) {
    throw new LtpFailure("proof_mismatch", "identity subject mismatch");
  }
  if (history.did !== subject || identity.historyRef !== history.id) {
    throw new LtpFailure("proof_mismatch", "history reference mismatch");
  }
  if (history.format !== "full" || history.checkpointRef !== null || history.startSeq !== 1) {
    throw new LtpFailure("checkpoint_required", "only full identity history is enabled");
  }
  const keys = sortPublicKeys(history.keys);
  if (new Set(keys.map(key => `${key.keyId ?? ""}|${key.fingerprint}`)).size !== keys.length) {
    throw new LtpFailure("proof_mismatch", "duplicate history keys");
  }
  return { identity, history };
}

function verifyArtifact(
  budget: ResourceBudget,
  jwk: JsonWebKey,
  compact: string,
  expectedTyp: string,
  expectedKid: string | null,
  stage: string,
): ParsedJws {
  const parsed = parseCompactJws(compact);
  if (!parsed) throw new LtpFailure("proof_mismatch", "malformed JWS", stage);
  if (parsed.header.alg !== "EdDSA" || headerString(parsed, "typ") !== expectedTyp) {
    throw new LtpFailure("bad_signature", "unexpected JWS algorithm or type", stage);
  }
  if (expectedKid !== null && headerString(parsed, "kid") !== expectedKid) {
    throw new LtpFailure("bad_signature", "JWS kid does not match the authenticated key", stage);
  }
  if (!isCanonicalPayload(parsed.payloadBytes)) throw new LtpFailure("not_canonical", "payload is not JCS", stage);
  budget.reserveSignature(stage);
  if (!verifyEd25519(jwk, parsed)) throw new LtpFailure("bad_signature", "invalid Ed25519 signature", stage);
  return parsed;
}

export function verifyHandoff(input: VerificationInput): VerificationOutcome {
  const consumed = input.acquisitionConsumed ?? [true, true];
  const slices: [boolean, boolean, boolean] = [false, false, false];
  const budget = input.budget;
  const { handoff, policy } = input;
  const sign = () => budget.signatureAttemptsUsed;
  const fail = (reason: LtpLocalReason, stopsBefore: string | null,
    identity: ComposedResult["identity"], history: ComposedResult["history"], effectiveValidUntil: number | null = null): VerificationFailure => ({
    ok: false,
    result: result(reason, stopsBefore, identity, history, consumed, slices, sign(), effectiveValidUntil),
  });
  const wallAt = input.wallAt ?? ((elapsed: number) => handoff.root.receivedAt + Math.floor(elapsed / 1000));

  try {
    if (handoff.packageBytes.byteLength > budget.limits.packageBytes) {
      return fail("response_limit_exceeded", "B-BINDINGS", "unverified", "not_started");
    }
    const pkgValue = parseJson(handoff.packageBytes);
    if (!pkgValue || typeof pkgValue !== "object" || Array.isArray(pkgValue)) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }
    const pkg = pkgValue as ProofPackage;
    if (digestJcs(pkg) !== handoff.packageDigest) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }
    const rootManifestDigest = digestJcs(handoff.root.manifest);
    if (rootManifestDigest !== handoff.root.rootManifestDigest || handoff.root.did !== handoff.subject) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }
    if (handoff.context.bodyBytesUsed > budget.limits.bodyBytes
      || handoff.context.httpAttemptsUsed > budget.limits.httpAttempts) {
      return fail("response_limit_exceeded", "B-BINDINGS", "unverified", "not_started");
    }
    if (handoff.context.deadlineAtMonotonicMs !== budget.limits.deadlineMs) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }

    let resolved: { identity: IdentityProof; history: HistoryProof };
    try {
      resolved = resolveProof(pkg, handoff.subject);
    } catch (error) {
      const failure = error as LtpFailure;
      return fail(failure.reason, "B-BINDINGS", "unverified", "not_started");
    }
    const { identity, history } = resolved;
    let key: { id: string; jwk: JsonWebKey };
    try {
      key = currentKey(identity);
    } catch (error) {
      const failure = error as LtpFailure;
      return fail(failure.reason, "B-BINDINGS", "unverified", "not_started");
    }
    if (jwkThumbprint(key.jwk) !== handoff.root.manifest.k) {
      return fail("key_mismatch", "B-LOG-1", "unverified", "not_started");
    }
    if (history.keys.length > 16 || history.entries.length > 400) {
      return fail("response_limit_exceeded", "B-BINDINGS", "unverified", "not_started");
    }
    if (digestJcs(sortPublicKeys(history.keys)) !== handoff.keySetDigest) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }

    let manifest: ParsedJws;
    try {
      manifest = verifyArtifact(budget, key.jwk, identity.manifestJws, MANIFEST_TYP, key.id, "B-BINDINGS");
    } catch (error) {
      const failure = error as LtpFailure;
      return fail(failure.reason, "B-BINDINGS", "unverified", "not_started");
    }
    const payload = manifest.payload;
    if (payload.did !== handoff.subject || payload.v !== 2 || payload.siteId !== handoff.root.manifest.siteId
      || payload.k !== handoff.root.manifest.k || payload.h !== handoff.root.manifest.h
      || payload.trustUrl !== handoff.root.manifest.trustUrl
      || digestJcs(Object.fromEntries(Object.entries(payload).filter(([field]) => field !== "iat"))) !== handoff.targetManifestDigest) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }

    let keySet: ParsedJws;
    try {
      keySet = verifyArtifact(budget, key.jwk, history.keySetJws, KEYSET_TYP, key.id, "B-BINDINGS");
    } catch (error) {
      const failure = error as LtpFailure;
      return fail(failure.reason, "B-BINDINGS", "unverified", "not_started");
    }
    const keySetPayload = keySet.payload;
    const expectedTerminal = history.terminal;
    if (keySetPayload.did !== handoff.subject || keySetPayload.version !== "0.1"
      || keySetPayload.keysDigest !== handoff.keySetDigest
      || typeof keySetPayload.iat !== "number" || typeof keySetPayload.exp !== "number"
      || keySetPayload.exp <= keySetPayload.iat
      || !keySetPayload.terminal || typeof keySetPayload.terminal !== "object"
      || (keySetPayload.terminal as { seq?: unknown }).seq !== expectedTerminal.seq
      || (keySetPayload.terminal as { hash?: unknown }).hash !== expectedTerminal.hash
      || payload.h !== expectedTerminal.hash) {
      return fail("proof_mismatch", "B-BINDINGS", "unverified", "not_started");
    }
    const bindingWall = wallAt(input.now());
    if (bindingWall + policy.clockSkewSeconds < (keySetPayload.iat as number)
      || bindingWall - policy.clockSkewSeconds >= (keySetPayload.exp as number)) {
      return fail("freshness_unproven", "B-BINDINGS", "unavailable", "not_started");
    }

    const policyDigest = digestJcs(policy);
    if (handoff.context.policyDigest !== policyDigest) {
      return fail("checkpoint_required", "B-BINDINGS", "unverified", "not_started");
    }
    const expected = expectedInitial(input, rootManifestDigest, policyDigest);
    let previousHash: string | null = null;
    let previousTs: number | null = null;
    if (!sameValue(input.states.initial, expected)) {
      return fail("checkpoint_required", "B-LOG-1", "unverified", "not_started");
    }

    for (let index = 0; index < history.entries.length; index += 1) {
      const stage = `B-LOG-${index + 1}`;
      const elapsed = input.now();
      if (elapsed >= budget.limits.deadlineMs) {
        return fail("deadline_exceeded", stage, "unavailable", index === 0 ? "not_started" : "partial");
      }
      if (index >= input.states.slices.length) {
        return fail("proof_incomplete", stage, "unverified", index === 0 ? "not_started" : "partial");
      }
      const slice = input.states.slices[index];
      const previous = index === 0 ? input.states.initial : input.states.slices[index - 1].output;
      if (!sameStateContinuity(previous, slice.input, budget.signatureAttemptsUsed, policyDigest)) {
        return fail("checkpoint_required", stage, "unverified", index === 0 ? "not_started" : "partial");
      }
      const entry = history.entries[index];
      // A quarantined slice is consumed when its state relation is read. If the
      // entry proof later fails, that slice remains consumed but is never promoted.
      const entryFailure = (reason: LtpLocalReason): VerificationFailure => {
        slices[index] = true;
        const next = index + 1 < history.entries.length ? `B-LOG-${index + 2}` : "B-PROMOTION";
        return fail(reason, next, "unverified", "invalid");
      };
      if (entry.seq !== index + 1) return entryFailure("seq_gap");
      const parsed = parseCompactJws(entry.jws);
      if (!parsed) return entryFailure("proof_mismatch");
      if (parsed.header.alg !== "EdDSA" || headerString(parsed, "typ") !== HISTORY_TYP) {
        return entryFailure("bad_signature");
      }
      const kid = headerString(parsed, "kid");
      const record = history.keys.find(candidate => candidate.keyId === kid);
      if (!record) return entryFailure("bad_signature");
      if (parsed.payload.seq !== entry.seq) return entryFailure("seq_gap");
      const timestamp = parseTimestamp(parsed.payload.ts);
      const window = keyWindow(record);
      if (timestamp < window.from || timestamp > window.to) {
        return entryFailure("ts_outside_key_window");
      }
      if (previousTs !== null && timestamp < previousTs) {
        return entryFailure("ts_regression");
      }
      if (!isCanonicalPayload(parsed.payloadBytes)) return entryFailure("not_canonical");
      budget.reserveSignature(stage);
      if (!verifyEd25519(record.publicKeyJwk, parsed)) {
        return entryFailure("bad_signature");
      }
      if (parsed.payload.prev !== previousHash) {
        return entryFailure("prev_mismatch");
      }
      const hash = jwsDigest(entry.jws);
      const expectedOutput: PrefixState = {
        ...slice.input,
        seq: entry.seq,
        hash,
        context: { ...slice.input.context, signatureAttemptsUsed: budget.signatureAttemptsUsed },
        trustClass: "quarantined-proposal",
      };
      if (!sameValue(slice.output, expectedOutput)) {
        return fail("checkpoint_required", stage, "unverified", "invalid");
      }
      slices[index] = true;
      previousHash = hash;
      previousTs = timestamp;
    }
    if (previousHash !== history.terminal.hash || history.terminal.seq !== history.entries.length) {
      return fail("proof_incomplete", "B-PROMOTION", "unverified", "partial");
    }

    const finalElapsed = input.now();
    if (finalElapsed >= budget.limits.deadlineMs) {
      return fail("deadline_exceeded", "B-PROMOTION", "unavailable", "verified");
    }
    const wall = wallAt(finalElapsed);
    const effectiveValidUntil = Math.min(handoff.root.validUntil, pkg.expiresAt);
    if (wall - handoff.root.receivedAt > policy.maxSnapshotAgeSeconds
      || !(wall < handoff.root.validUntil) || !(wall < pkg.expiresAt)) {
      return fail("freshness_unproven", "B-PROMOTION", "unavailable", "verified");
    }
    return {
      ok: true,
      result: result(null, null, "verified", "verified", consumed, slices, sign(), effectiveValidUntil),
    };
  } catch (error) {
    const failure = error instanceof LtpFailure
      ? error
      : new LtpFailure("proof_mismatch", `verification failed: ${(error as Error).message}`);
    return fail(failure.reason, failure.stage ?? "B-BINDINGS", "unverified", "not_started");
  }
}
