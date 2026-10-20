import {
  PRIOR_WEIGHT,
  NEUTRAL,
  calibrateJudges,
  type DimensionScore,
  type ScoredAttestation,
  type Source,
} from "./scoring";
import {
  CATEGORY_DIMENSION,
  escrowOutcomeValue,
  scoreSiteDimensions,
  snapshotToAttestations,
  type SiteSnapshotLike,
} from "./site-dimensions";
import {
  communityPredicate,
  emitterAgeOk,
  latestPerEmitter,
  type CommunityRow,
} from "./community";

export const SVRI_VERSION = "1.0" as const;
export const SVRI_SITE_PROFILE = "ltp-svri-site-v1" as const;

/**
 * Site dimensions that require direct T1/T2 evidence. W-09 is derived from
 * coherence (Annex A.5) and therefore has no direct signature of its own.
 */
export const REQUIRED_SITE_DIMENSIONS = [
  "W-01",
  "W-02",
  "W-03",
  "W-04",
  "W-05",
  "W-06",
  "W-07",
  "W-08",
  "W-10",
] as const;

export type SvriLevel = "pending" | "low" | "verify" | "safe" | "reliable";

export interface SvriTierCounts {
  t1Count: number;
  t2Count: number;
  t3Count: number;
  t4Count: number;
  t5Count: number;
}

export interface SvriProjection extends SvriTierCounts {
  version: typeof SVRI_VERSION;
  profile: typeof SVRI_SITE_PROFILE;
  score: number;
  incompleteData: boolean;
  isInference: boolean;
  priorShare: number;
  effectiveWeight: number;
  dimensionCount: number;
  rulesVersion: typeof SVRI_SITE_PROFILE;
  publicLevel: SvriLevel;
}

export interface SvriVectorInput extends SvriTierCounts {
  /** LTP 1–7 DimensionScore values after evidence verification and E-13 gates. */
  dimensions: ReadonlyArray<DimensionScore>;
}

export interface SvriPublicProjection {
  version: typeof SVRI_VERSION;
  publicLevel: SvriLevel;
}

export type EvidenceExclusionReason =
  | "dimension_missing"
  | "insufficient_weight"
  | "emitter_too_new"
  | "unsigned_legacy"
  | "invalid_value"
  | "duplicate_superseded";

/** One source record considered by the engine, accepted or not. */
export interface EvaluatedAttestation {
  attestationId: string;
  issuer: string;
  source: Source;
  tier: "T1" | "T2" | "T3" | "T4" | "T5";
  category?: string;
  dimension?: string;
  value?: number;
}

export interface ExcludedEvidence extends EvaluatedAttestation {
  reason: EvidenceExclusionReason;
  detail?: string;
}

/**
 * Strict evidence context: every attestation the engine evaluated, the subset
 * that actually contributed to dimensions, and the normative reason for every
 * exclusion. Nothing here is inferred from a numeric score.
 */
export interface EvidenceContext {
  siteId: string;
  siteDid?: string;
  attestations: EvaluatedAttestation[];
  acceptedAttestations: ScoredAttestation[];
  acceptedSourceRecords: Array<{ tier: EvaluatedAttestation["tier"]; issuer: string; attestationId: string }>;
  excludedEvidence: ExcludedEvidence[];
  missingDimensions: string[];
  dimensions: DimensionScore[];
  tierCounts: SvriTierCounts;
}

export interface SvriSiteDetail {
  svri: SvriProjection;
  dimensions: DimensionScore[];
  verifiedSourceRecords: Array<{ tier: "T1" | "T2" | "T3" | "T4" | "T5"; issuer: string; attestationId: string }>;
  excludedEvidence: ExcludedEvidence[];
  missingDimensions: string[];
  evidence: EvidenceContext;
}

export interface SvriSiteBuildOptions {
  /** Reader-conduct events emitted by this site; counted as T4 activity, never as site W evidence. */
  readerConductRecords?: ReadonlyArray<{ issuer: string; attestationId: string }>;
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
}

/** Deterministic SVRI projection from verified LTP dimensions and source counts. */
export function projectSvri(input: SvriVectorInput): SvriProjection {
  for (const key of ["t1Count", "t2Count", "t3Count", "t4Count", "t5Count"] as const) {
    requireNonNegativeInteger(input[key], key);
  }
  for (const dimension of input.dimensions) {
    if (!Number.isFinite(dimension.score) || dimension.score < 1 || dimension.score > 7 ||
        !Number.isFinite(dimension.weightSum) || dimension.weightSum < 0 ||
        !Number.isInteger(dimension.count) || dimension.count < 0) {
      throw new TypeError(`invalid LTP dimension: ${dimension.dimension}`);
    }
  }
  const dimensionsSeen = new Set<string>();
  for (const dimension of input.dimensions) {
    if (!dimension.dimension || dimensionsSeen.has(dimension.dimension)) throw new TypeError(`duplicate or empty LTP dimension: ${dimension.dimension}`);
    dimensionsSeen.add(dimension.dimension);
  }

  // Zero-weight dimensions are protocol priors, not observations and do not
  // enter the aggregate or its prior-share denominator.
  const measured = input.dimensions.filter((dimension) => dimension.count > 0 && dimension.weightSum > 0);
  const effectiveWeight = measured.reduce((sum, dimension) => sum + dimension.weightSum, 0);
  const priorWeight = PRIOR_WEIGHT * measured.length;
  const priorShare = priorWeight + effectiveWeight === 0 ? 1 : priorWeight / (priorWeight + effectiveWeight);
  const ltpScore = measured.length === 0
    ? NEUTRAL
    : measured.reduce((sum, dimension) => sum + dimension.score, 0) / measured.length;
  const score = Math.round((10 * (ltpScore - 1) / 6) * 1_000_000) / 1_000_000;
  const incompleteData = input.t1Count + input.t2Count === 0;
  const isInference = priorShare > 0.5;
  const publicLevel = classifySvriLevel({ score, incompleteData, isInference, t1Count: input.t1Count, t2Count: input.t2Count });

  return {
    version: SVRI_VERSION,
    profile: SVRI_SITE_PROFILE,
    score,
    t1Count: input.t1Count,
    t2Count: input.t2Count,
    t3Count: input.t3Count,
    t4Count: input.t4Count,
    t5Count: input.t5Count,
    incompleteData,
    isInference,
    priorShare: Math.round(priorShare * 1_000_000) / 1_000_000,
    effectiveWeight: Math.round(effectiveWeight * 1_000_000) / 1_000_000,
    dimensionCount: measured.length,
    rulesVersion: SVRI_SITE_PROFILE,
    publicLevel,
  };
}

export function classifySvriLevel(input: Pick<SvriProjection, "score" | "incompleteData" | "isInference" | "t1Count" | "t2Count">): SvriLevel {
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 10 || input.incompleteData || input.t1Count + input.t2Count === 0) return "pending";
  if (input.score < 5) return "low";
  if (input.score < 7 || input.isInference) return "verify";
  if (input.score < 9) return "safe";
  return "reliable";
}

function uniqueCount(ids: ReadonlyArray<string>): number {
  return new Set(ids).size;
}

function booleanValue(value: unknown): number | undefined {
  if (value === true) return 7;
  if (value === false) return 1;
  return undefined;
}

function communityValue(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5
    ? 1 + (((value as number) - 1) * 6) / 4
    : undefined;
}

function sourceTier(source: Source): EvaluatedAttestation["tier"] {
  switch (source) {
    case "escrow_report": return "T1";
    case "self": return "T2";
    case "community": return "T3";
    case "reader_conduct": return "T4";
    case "agent": return "T5";
  }
}

function scopedId(issuer: string, id: string): string {
  return `${issuer}\u0000${id}`;
}

type CommunityCandidate = {
  row: NonNullable<SiteSnapshotLike["community"]>[number];
  item: EvaluatedAttestation;
  communityRow: CommunityRow;
};

/**
 * Builds the evidence context from snapshot rows. Every row is evaluated
 * exactly once: accepted rows feed the LTP engine, excluded rows keep a
 * normative reason instead of disappearing.
 */
export function buildSiteEvidenceContext(
  snapshot: SiteSnapshotLike,
  options: SvriSiteBuildOptions = {},
): EvidenceContext {
  const siteDid = snapshot.siteDid ?? `did:apw:${snapshot.siteId}`;
  const attestations: EvaluatedAttestation[] = [];
  const excludedEvidence: ExcludedEvidence[] = [];
  const acceptedSelf: NonNullable<SiteSnapshotLike["self"]>[number][] = [];
  const acceptedAgent: NonNullable<SiteSnapshotLike["agent"]>[number][] = [];
  const acceptedEscrow: NonNullable<SiteSnapshotLike["escrowReports"]>[number][] = [];
  const communityCandidates: CommunityCandidate[] = [];
  const acceptedSourceRecords: EvidenceContext["acceptedSourceRecords"] = [];

  const exclude = (item: EvaluatedAttestation, reason: EvidenceExclusionReason, detail?: string): void => {
    excludedEvidence.push({ ...item, reason, ...(detail ? { detail } : {}) });
  };

  for (const row of snapshot.self ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const item: EvaluatedAttestation = {
      attestationId: row.attestationJti ?? `self:${siteDid}:${row.category}`,
      issuer: row.declaredBy ?? siteDid,
      source: "self",
      tier: "T2",
      category: row.category,
      ...(dimension ? { dimension } : {}),
      ...(booleanValue(row.declaredValue) !== undefined ? { value: booleanValue(row.declaredValue) } : {}),
    };
    attestations.push(item);
    if (booleanValue(row.declaredValue) === undefined) {
      exclude(item, "invalid_value", "declaredValue must be boolean");
    } else if (typeof row.attestationJws !== "string" || !row.attestationJws ||
               typeof row.attestationJti !== "string" || !row.attestationJti) {
      exclude(item, "unsigned_legacy", "missing attestationJws or attestationJti");
    } else if (!dimension) {
      exclude(item, "dimension_missing", `category ${row.category} has no LTP dimension`);
    } else {
      acceptedSelf.push(row);
      acceptedSourceRecords.push({ tier: "T2", issuer: siteDid, attestationId: row.attestationJti });
    }
  }

  for (const row of snapshot.agent ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const item: EvaluatedAttestation = {
      attestationId: row.attestationJti ?? `agent:${row.agentKeyId}:${row.category}:${row.verifiedAt}`,
      issuer: row.agentKeyId,
      source: "agent",
      tier: "T5",
      category: row.category,
      ...(dimension ? { dimension } : {}),
      ...(booleanValue(row.verified) !== undefined ? { value: booleanValue(row.verified) } : {}),
    };
    attestations.push(item);
    if (booleanValue(row.verified) === undefined) {
      exclude(item, "invalid_value", "verified must be boolean");
    } else if (typeof row.attestationJws !== "string" || !row.attestationJws ||
               typeof row.attestationJti !== "string" || !row.attestationJti) {
      exclude(item, "unsigned_legacy", "missing attestationJws or attestationJti");
    } else if (!dimension) {
      exclude(item, "dimension_missing", `category ${row.category} has no LTP dimension`);
    } else {
      acceptedAgent.push(row);
      acceptedSourceRecords.push({ tier: "T5", issuer: row.agentKeyId, attestationId: row.attestationJti });
    }
  }

  for (const row of snapshot.escrowReports ?? []) {
    const outcome = escrowOutcomeValue(row.transactionOutcome);
    const item: EvaluatedAttestation = {
      attestationId: row.attestationJti ?? `escrow:${row.escrowProvider}:${row.reportedAt}`,
      issuer: row.escrowProvider,
      source: "escrow_report",
      tier: "T1",
      category: row.transactionOutcome,
      dimension: "W-05",
      ...(outcome !== null ? { value: outcome } : {}),
    };
    attestations.push(item);
    if (outcome === null) {
      exclude(item, "invalid_value", `unknown transaction outcome ${row.transactionOutcome}`);
    } else if (typeof row.attestationJws !== "string" || !row.attestationJws ||
               typeof row.attestationJti !== "string" || !row.attestationJti) {
      exclude(item, "unsigned_legacy", "missing attestationJws or attestationJti");
    } else {
      acceptedEscrow.push(row);
      acceptedSourceRecords.push({ tier: "T1", issuer: row.escrowProvider, attestationId: row.attestationJti });
    }
  }

  for (const row of snapshot.community ?? []) {
    const dimension = CATEGORY_DIMENSION[row.category];
    const item: EvaluatedAttestation = {
      attestationId: row.jti ?? `${row.iss ?? "unknown"}:${row.category}:${row.iat ?? "unknown"}`,
      issuer: row.iss ?? row.voterId ?? "anonymous",
      source: "community",
      tier: "T3",
      category: row.category,
      ...(dimension ? { dimension } : {}),
      ...(communityValue(row.score) !== undefined ? { value: communityValue(row.score) } : {}),
    };
    attestations.push(item);

    if (typeof row.iss !== "string" || !row.iss ||
        typeof row.jti !== "string" || !row.jti ||
        typeof row.attestationJws !== "string" || !row.attestationJws) {
      exclude(item, "unsigned_legacy", "community row has no verified issuer, jti or JWS");
    } else if (communityValue(row.score) === undefined || typeof row.iat !== "number" || !Number.isFinite(row.iat)) {
      exclude(item, "invalid_value", "community score or iat is out of range");
    } else if (!dimension) {
      exclude(item, "dimension_missing", `category ${row.category} has no LTP dimension`);
    } else {
      communityCandidates.push({
        row,
        item,
        communityRow: {
          iss: row.iss,
          category: row.category,
          val: row.score,
          iat: row.iat,
          jti: row.jti,
          emitterFirstSeenIat: row.emitterFirstSeenIat ?? null,
        },
      });
    }
  }

  // E-13 first pass: dedupe per (issuer, category) and drop emitters whose
  // verified history is younger than seven days. Both exclusions are explicit.
  const byCategory = new Map<string, CommunityCandidate[]>();
  for (const candidate of communityCandidates) {
    const list = byCategory.get(candidate.row.category) ?? [];
    list.push(candidate);
    byCategory.set(candidate.row.category, list);
  }

  const ageEligible: CommunityCandidate[] = [];
  for (const candidates of byCategory.values()) {
    const latest = new Set(latestPerEmitter(candidates.map((candidate) => candidate.communityRow)).map((row) => row.jti));
    for (const candidate of candidates) {
      if (!latest.has(candidate.communityRow.jti)) {
        exclude(candidate.item, "duplicate_superseded", "a newer attestation from the same issuer supersedes this one");
      } else if (!emitterAgeOk(candidate.communityRow.iat, candidate.communityRow.emitterFirstSeenIat)) {
        exclude(candidate.item, "emitter_too_new", "issuer history is younger than the 7-day E-13 minimum");
      } else {
        ageEligible.push(candidate);
      }
    }
  }

  // Calibration used by the community min_weight gate (same order as
  // scoreSiteDimensions: calibrate first, then gate per category).
  const preSnapshot: SiteSnapshotLike = {
    siteId: snapshot.siteId,
    siteDid,
    self: acceptedSelf,
    agent: acceptedAgent,
    community: ageEligible.map((candidate) => candidate.row),
    escrowReports: acceptedEscrow,
  };
  const preJudges = calibrateJudges(snapshotToAttestations(preSnapshot));

  const acceptedCommunity: NonNullable<SiteSnapshotLike["community"]>[number][] = [];
  for (const [category, candidates] of byCategory) {
    const eligible = candidates.filter((candidate) => ageEligible.includes(candidate));
    if (eligible.length === 0) continue;
    const predicate = communityPredicate(eligible.map((candidate) => candidate.communityRow), preJudges);
    if (!predicate.passes) {
      for (const candidate of eligible) {
        exclude(candidate.item, "insufficient_weight", `category ${category} did not reach the E-13 min_weight of 2.0`);
      }
    } else {
      for (const candidate of eligible) {
        acceptedCommunity.push(candidate.row);
        acceptedSourceRecords.push({ tier: "T3", issuer: candidate.row.iss!, attestationId: candidate.row.jti! });
      }
    }
  }

  const acceptedSnapshot: SiteSnapshotLike = {
    siteId: snapshot.siteId,
    siteDid,
    self: acceptedSelf,
    agent: acceptedAgent,
    community: acceptedCommunity,
    escrowReports: acceptedEscrow,
  };
  const dimensions = [...scoreSiteDimensions(acceptedSnapshot).values()];
  const acceptedAttestations = snapshotToAttestations(acceptedSnapshot);

  const tierCounts: SvriTierCounts = {
    t1Count: uniqueCount(acceptedEscrow.map((row) => scopedId(row.escrowProvider, row.attestationJti!))),
    t2Count: uniqueCount(acceptedSelf.map((row) => row.attestationJti!)),
    t3Count: uniqueCount(acceptedCommunity.map((row) => scopedId(row.iss!, row.jti!))),
    // T4 is recorded for observability, but reader-conduct scores the reader
    // (R), not the emitting site's W profile.
    t4Count: uniqueCount((options.readerConductRecords ?? []).map((row) => scopedId(row.issuer, row.attestationId))),
    t5Count: uniqueCount(acceptedAgent.map((row) => scopedId(row.agentKeyId, row.attestationJti!))),
  };

  const directPrimaryDimensions = new Set<string>();
  for (const row of acceptedSelf) {
    const dimension = CATEGORY_DIMENSION[row.category];
    if (dimension) directPrimaryDimensions.add(dimension);
  }
  if (acceptedEscrow.length > 0) directPrimaryDimensions.add("W-05");
  const missingDimensions = REQUIRED_SITE_DIMENSIONS.filter((dimension) => !directPrimaryDimensions.has(dimension));

  for (const row of options.readerConductRecords ?? []) {
    acceptedSourceRecords.push({ tier: "T4", issuer: row.issuer, attestationId: row.attestationId });
  }

  return {
    siteId: snapshot.siteId,
    siteDid,
    attestations,
    acceptedAttestations,
    acceptedSourceRecords,
    excludedEvidence,
    missingDimensions: [...missingDimensions],
    dimensions,
    tierCounts,
  };
}

/**
 * Site SVRI from rows admitted by Portaless' signature-verifying ingestion
 * paths. Legacy rows without stored JWS+jti remain visible in the old snapshot
 * but do not contribute to this verified projection.
 */
export function buildSiteSvri(snapshot: SiteSnapshotLike, options: SvriSiteBuildOptions = {}): SvriProjection {
  return buildSiteSvriDetail(snapshot, options).svri;
}

export function buildSiteSvriDetail(snapshot: SiteSnapshotLike, options: SvriSiteBuildOptions = {}): SvriSiteDetail {
  const evidence = buildSiteEvidenceContext(snapshot, options);
  const svri = projectSvri({ dimensions: evidence.dimensions, ...evidence.tierCounts });

  return {
    svri,
    dimensions: evidence.dimensions,
    verifiedSourceRecords: evidence.acceptedSourceRecords.map((record) => ({ ...record })),
    excludedEvidence: evidence.excludedEvidence,
    missingDimensions: evidence.missingDimensions,
    evidence,
  };
}

/** Public payload deliberately omits score, tiers, counts and prior share. */
export function toPublicSvriProjection(svri: SvriProjection): SvriPublicProjection {
  return { version: svri.version, publicLevel: svri.publicLevel };
}
