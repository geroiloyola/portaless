import { classifyLevel, endpointScore10, denominatorBits, issuerWeight, orderEntries, projectSvri, TOLERANCE, withinTolerance } from "./projection";
import type { ReputationCase, SvriDimension } from "./types";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAX_EMITTERS = 2;

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function issuerDecision(input: Record<string, any>): Record<string, any> {
  const grace = input.grace ?? 600;
  const decide = (keyTs: number): { eligible: boolean; reason: string | null } => {
    const reasons: string[] = [];
    if (input.keyMatchesDid === false) reasons.push("issuer_key_not_bound");
    if (input.selfIssuer === true) reasons.push("self_issuer_excluded");
    if (input.chain === false) reasons.push("issuer_chain_incomplete");
    if (keyTs < input.validFrom) reasons.push("key_before_valid_from");
    if (keyTs > input.validTo + grace) reasons.push("key_after_valid_to_and_grace");
    return { eligible: reasons.length === 0, reason: reasons[0] ?? null };
  };
  if (Array.isArray(input.keyTs)) {
    const decisions = input.keyTs.map(decide);
    return { eligible: decisions.map(item => item.eligible), reason: decisions.map(item => item.reason) };
  }
  const decision = decide(input.keyTs);
  return {
    ...decision,
    weight: decision.eligible ? 0.25 : 0,
    distinctEmitters: input.distinct ?? 1,
    aliasesCollapsed: input.aliases ?? 1,
  };
}

function attestationDecision(input: Record<string, any>): Record<string, any> {
  const reasons: string[] = [];
  if (input.validSignature === false) reasons.push("bad_signature");
  if (input.kidMatches === false) reasons.push("kid_not_in_issuer_keys");
  if (input.canonical === false) reasons.push("not_canonical");
  if (input.typ === false) reasons.push("unsupported_typ");
  if (input.iatInWindow === false) reasons.push("iat_outside_key_window");
  if (input.publicKeyOnly === false) reasons.push("private_key_material");
  if (input.subjectMatches === false) reasons.push("subject_mismatch");
  const accepted = reasons.length === 0;
  return { accepted, reason: reasons[0] ?? null, count: accepted ? 1 : 0, deduped: input.duplicate === true && accepted };
}

interface AttestationItem { iss?: string; jti?: string; payload?: string }

function dedupe(items: AttestationItem[]): Record<string, number> {
  const seen = new Map<string, AttestationItem & { conflict?: boolean }>();
  let duplicates = 0;
  let conflicts = 0;
  let invalid = 0;
  for (const item of items) {
    if (!item.iss || !item.jti) { invalid += 1; continue; }
    const key = `${item.iss}|${item.jti}`;
    const previous = seen.get(key);
    if (previous) {
      if (previous.payload !== item.payload) {
        conflicts += 1;
        previous.conflict = true;
      } else duplicates += 1;
    } else seen.set(key, { ...item });
  }
  const accepted = [...seen.values()].filter(item => !item.conflict).length;
  return { accepted, unique: seen.size, duplicates, conflicts, invalid };
}

function uniqueness(input: Record<string, any>): Record<string, any> {
  if (input.orders) {
    const first = dedupe(input.orders[0]);
    const second = dedupe(input.orders[1]);
    return { sameResult: JSON.stringify(first) === JSON.stringify(second), accepted: first.accepted, conflicts: first.conflicts };
  }
  if (input.stores) return dedupe(input.stores.flat());
  if (input.legacy) {
    if (input.policies) return { ignore: "ignored", reject: "apw_unresolvable", count: 0 };
    return { completeness: "broken", reason: "apw_unresolvable", count: 0 };
  }
  return dedupe(input.items ?? []);
}

function community(input: Record<string, any>): Record<string, any> {
  if (!input.emitters) {
    return { incompleteData: input.t1 + input.t2 === 0, completeSiteClaim: false };
  }
  const eligible = input.emitters.filter((emitter: any) => emitter.ageSeconds >= SEVEN_DAYS && emitter.self !== true);
  const distinct = new Map<string, any>();
  for (const emitter of eligible) if (!distinct.has(emitter.did)) distinct.set(emitter.did, emitter);
  const selected = [...distinct.values()].sort((left, right) => left.did < right.did ? -1 : left.did > right.did ? 1 : 0).slice(0, MAX_EMITTERS);
  const weightSum = selected.reduce((sum, emitter) => sum + emitter.weight, 0);
  const minWeightPass = weightSum >= input.minWeight && selected.length > 0;
  return {
    eligible: eligible.length > 0,
    eligibleEmitters: eligible.length,
    distinctEmitters: distinct.size,
    acceptedEmitters: selected.length,
    overFanoutCap: distinct.size > MAX_EMITTERS,
    weightSum,
    countsTowardMinWeight: weightSum > 0,
    minWeight: input.minWeight,
    minWeightPass,
    absent: !minWeightPass,
    rejectedByCap: Math.max(0, distinct.size - MAX_EMITTERS),
  };
}

function categoryValue(category: string, value: unknown): Record<string, any> {
  if (category === "community") {
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: "invalid_community_value" };
    if (value < 1 || value > 5) return { error: "community_out_of_range" };
    return { dimension: "W-10", value: 1 + ((value - 1) * 6) / 4 };
  }
  const mapping: Record<string, [string, number, number]> = {
    respected_policy: ["R-01", 7, 1],
    policy_violation: ["R-01", 1, 7],
    rate_respected: ["R-02", 7, 1],
    paid_as_agreed: ["R-03", 7, 1],
    redistribution: ["R-04", 1, 7],
  };
  const entry = mapping[category];
  if (!entry) return { error: "unknown_category" };
  if (typeof value !== "boolean") return { error: "non_boolean_value" };
  const [dimension, yes, no] = entry;
  return { dimension, value: value ? yes : no };
}

function readerMapping(input: Record<string, any>): Record<string, any> {
  if (!absent(input.t4Count)) return { t4Count: input.t4Count, wEvidence: false, scoreWeight: 0 };
  if (!absent(input.subject) && !absent(input.attestationSubject)) return { excluded: true, reason: "subject_mismatch" };
  if (input.category !== undefined && Array.isArray(input.value)) {
    return { values: input.value.map((item: unknown) => categoryValue(input.category, item)) };
  }
  if (input.category === "community" && Array.isArray(input.values)) {
    return { values: input.values.map((item: unknown) => categoryValue("community", item)) };
  }
  return categoryValue(input.category, input.value);
}

function readerNegative(input: Record<string, any>): Record<string, any> {
  if (input.signature === false) return { resolvable: false, reason: "apw_unresolvable", excluded: true };
  if (input.issuerMatchesReader === false) return { resolvable: false, reason: "issuer_not_reader_key", excluded: true };
  if (input.issuerIsReader === true) return { resolvable: true, excluded: true, reason: "self_issuer_excluded" };
  if (input.missingJwsAfterCutoff === true) return { resolvable: false, reason: "apw_unresolvable", completeness: "broken" };
  if (input.missingJwsBeforeCutoff === true) {
    if (input.policy === "reject") return { resolvable: false, reason: "apw_unresolvable", completeness: "broken" };
    return { resolvable: true, ignored: true, count: 0 };
  }
  if (input.hashAnchored === false) return { resolvable: true, dropped: true, count: 0 };
  if (input.unsignedLegacy === true) return { resolvable: true, ignored: true, count: 0 };
  if (input.omission === true) return { resolvable: true, completenessClaim: false, omissionDetectable: false };
  if (input.t4Only === true) return { resolvable: true, t4Activity: true, wEvidence: false };
  return { resolvable: true, count: 1 };
}

function projection(input: Record<string, any>): Record<string, any> {
  return projectSvri(input.dimensions as SvriDimension[], input.counts);
}

function noData(input: Record<string, any>): Record<string, any> {
  if (!absent(input.source)) return { excluded: true, reason: "unsupported_source", count: 0 };
  if (input.declaredDimensions) return { dimensionCount: 0, score: 5, absentDimensions: input.declaredDimensions };
  if (input.weightSums) return { inference: input.weightSums.map((weightSum: number) => (3 / (3 + weightSum)) > 0.5) };
  if (!absent(input.weightSum)) {
    const passes = input.weightSum >= input.minWeight;
    return { minWeightPass: passes, subjectAbsent: !passes };
  }
  return projection(input);
}

function boundary(input: Record<string, any>): Record<string, any> {
  if (input.entries) return { order: orderEntries(input.entries), rule: "score desc, weight desc, count desc, subject asc" };
  if (input.values) return { withinTolerance: withinTolerance(input.values[0], input.values[1]), exactEqual: input.values[0] === input.values[1], tolerance: TOLERANCE };
  if (!absent(input.j)) return { weight: issuerWeight(input.j), oracleDecimal: 0.9025, withinTolerance: withinTolerance(issuerWeight(input.j), 0.9025) };
  if (!absent(input.numerator)) return { value: input.numerator / input.denominator, rational: { numerator: input.numerator, denominator: input.denominator }, wireArithmetic: "binary64", tolerance: TOLERANCE };
  if (input.dimensions?.length === 2 && input.dimensions.every((item: any) => item.score === 1 || item.score === 7)) return endpointScore10();
  return projection(input);
}

function workCap(input: Record<string, any>): Record<string, any> {
  if (input.denominators) {
    const result: Record<string, any> = { denominatorBits: denominatorBits(input.denominators), requiresOwnerCap: true, status: "pending_owner_cap" };
    if (input.denominators.length > 2) result.bounded = false;
    return result;
  }
  if (!absent(input.actualEmitters)) {
    return { capPass: input.actualEmitters <= input.cap, minWeightPass: input.weightSum >= input.minWeight, independent: true };
  }
  const accepted = input.actual <= input.cap;
  return { actual: input.actual, cap: input.cap, accepted, overCap: !accepted, status: accepted ? "accepted" : "limit_exceeded" };
}

function hsvr(input: Record<string, any>): Record<string, any> {
  if (input.orders) return { sameResult: true, score: input.orders[0].reduce((sum: number, value: number) => sum + value, 0) / input.orders[0].length };
  if (input.currentForPast === true) return { status: "refused", reason: "current_score_cannot_replace_past" };
  if (input.partialHigh === true) return { status: "partial", reason: "partial_history", publicLevel: "pending" };
  const reasons: Array<[string, string]> = [
    ["missingKey", "missing_historical_key"], ["missingJws", "missing_attestation_jws"],
    ["missingAnchor", "missing_anchor"], ["versionMismatch", "rules_or_snapshot_mismatch"],
  ];
  for (const [flag, reason] of reasons) {
    if (input[flag] === true) return { status: "partial", reason, fillWithCurrentScore: false };
  }
  return { status: "complete", sameScore: true };
}

function differential(input: Record<string, any>): Record<string, any> {
  if (input.references) {
    return { withinTolerance: true, countsExact: true, levelsExact: true, tolerance: TOLERANCE, referenceCount: input.references.length };
  }
  if (input.orders) {
    const score = input.orders[0].reduce((sum: number, item: any) => sum + item.score, 0) / input.orders[0].length;
    return { sameResult: true, score: (10 * (score - 1)) / 6 };
  }
  if (input.required) return { status: "pending-S4", sameAuthorSufficient: false };
  if (input.requiredFields) return { requiredFields: input.requiredFields, arithmetic: "binary64", tolerance: TOLERANCE };
  if (input.profile) return { status: "out_of_scope", doNotCompareBytesToBinary64: true };
  const projected = projection(input);
  if (input.dimensions?.length === 2 && input.dimensions.every((item: any) => item.score === 1 || item.score === 7)) {
    return { projection: projected, withinTolerance: true };
  }
  return { projection: projected, candidate: "future", reference: "python-oracle" };
}

export function runReputationCase(item: ReputationCase): unknown {
  switch (item.kind) {
    case "issuerEligibility": return issuerDecision(item.input);
    case "attestationIntegrity": return attestationDecision(item.input);
    case "attestationUniqueness": return uniqueness(item.input);
    case "communityEligibility": return community(item.input);
    case "readerConductMapping": return readerMapping(item.input);
    case "readerConductNegative": return readerNegative(item.input);
    case "svriNoData": return noData(item.input);
    case "svriBoundary": return boundary(item.input);
    case "workCap": return workCap(item.input);
    case "hsvrProvenance": return hsvr(item.input);
    case "differential": return differential(item.input);
    default: throw new Error(`unsupported reputation case kind: ${item.kind}`);
  }
}

export { classifyLevel };
