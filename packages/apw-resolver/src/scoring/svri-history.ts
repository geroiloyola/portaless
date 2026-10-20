import { sha256B64Url, verifyChain, type ChainKey } from "../did-apw/history-log";
import type { AttestationLogEntry } from "../did-apw/attestation-log-store";
import { buildSiteSvriDetail, type SvriSiteDetail } from "./svri";
import type { SiteSnapshotLike } from "./site-dimensions";

export interface SvriAttestationClaims {
  typ: "apw-attestation+jws";
  iss: string;
  sub: string;
  src: "self" | "agent" | "community" | "escrow_report" | "reader_conduct";
  cat: string;
  val: boolean | number;
  iat: number;
  jti: string;
}

export interface SvriHistoryEvent {
  sequence: number;
  recordedAt: string;
  source: string;
  tier: "T1" | "T2" | "T3" | "T4" | "T5" | null;
  issuer: string | null;
  attestationId: string | null;
  entryHash: string | null;
  anchored: boolean;
  accepted: boolean;
  reason?: string;
  svri: SvriSiteDetail["svri"];
}

export interface ReconstructSvriHistoryInput {
  siteId: string;
  siteDid: string;
  entries: ReadonlyArray<AttestationLogEntry>;
  keys: ChainKey[];
  activeFingerprint: string;
  anchorHead?: string | null;
  identityCreatedAt?: string;
  communityFirstSeen?: ReadonlyMap<string, number | null>;
  verifySource: (jws: string, claims: SvriAttestationClaims, kid: string | null) => Promise<{ verified: boolean; reason?: string }>;
}

export interface ReconstructedSvriHistory {
  status: "complete" | "partial" | "chain_invalid";
  chainValid: boolean;
  chainReason?: string;
  anchoredSeq: number | null;
  unanchoredEntries: number;
  events: SvriHistoryEvent[];
  /** Final score and sources reconstructed only from accepted log-backed JWS records. */
  detail?: SvriSiteDetail;
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

function parseAttestation(jws: string): { header: Record<string, unknown>; claims: SvriAttestationClaims } | null {
  const parts = jws.split(".");
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload || header.alg !== "EdDSA" || payload.typ !== "apw-attestation+jws") return null;
  const src = payload.src;
  const validSource = ["self", "agent", "community", "escrow_report", "reader_conduct"].includes(String(src));
  if (!validSource || typeof payload.iss !== "string" || typeof payload.sub !== "string" ||
      typeof payload.cat !== "string" || typeof payload.jti !== "string" || !Number.isSafeInteger(payload.iat)) return null;
  if (src === "community" ? !Number.isInteger(payload.val) || Number(payload.val) < 1 || Number(payload.val) > 5 : typeof payload.val !== "boolean") return null;
  return { header, claims: payload as unknown as SvriAttestationClaims };
}

export function readSvriAttestationClaims(jws: string): { header: Record<string, unknown>; claims: SvriAttestationClaims } | null {
  return parseAttestation(jws);
}

function sourceTier(source: SvriAttestationClaims["src"]): SvriHistoryEvent["tier"] {
  switch (source) {
    case "escrow_report": return "T1";
    case "self": return "T2";
    case "community": return "T3";
    case "reader_conduct": return "T4";
    case "agent": return "T5";
  }
}

function emptySnapshot(siteId: string): SiteSnapshotLike {
  return { siteId, self: [], agent: [], community: [], escrowReports: [] };
}

/** Replays the site's append-only APW log; missing proof or missing anchors stay visible as partial. */
export async function reconstructSvriHistory(input: ReconstructSvriHistoryInput): Promise<ReconstructedSvriHistory> {
  const entries = [...input.entries].sort((a, b) => a.seq - b.seq);
  const chain = await verifyChain(entries.map((entry) => ({ seq: entry.seq, jws: entry.entryJws })), input.keys, {
    expectedDid: input.siteDid,
    activeFingerprint: input.activeFingerprint,
    ...(input.anchorHead ? { anchorHead: input.anchorHead } : {}),
  });
  if (!chain.valid) {
    return { status: "chain_invalid", chainValid: false, chainReason: chain.reason, anchoredSeq: null, unanchoredEntries: entries.length, events: [] };
  }

  const self = new Map<string, NonNullable<SiteSnapshotLike["self"]>[number]>();
  const agent = new Map<string, NonNullable<SiteSnapshotLike["agent"]>[number]>();
  const community = new Map<string, NonNullable<SiteSnapshotLike["community"]>[number]>();
  const escrowReports = new Map<string, NonNullable<SiteSnapshotLike["escrowReports"]>[number]>();
  const readerConduct = new Map<string, { issuer: string; attestationId: string }>();
  const events: SvriHistoryEvent[] = [];
  let partial = !input.anchorHead || chain.anchoredSeq !== entries.length;
  const siteDid = input.siteDid;
  const initial = buildSiteSvriDetail(emptySnapshot(input.siteId));
  events.push({
    sequence: 0,
    recordedAt: input.identityCreatedAt ?? entries[0]?.ts ?? new Date(0).toISOString(),
    source: "initial-prior",
    tier: null,
    issuer: null,
    attestationId: null,
    entryHash: null,
    anchored: true,
    accepted: true,
    svri: initial.svri,
  });

  for (const entry of entries) {
    const logParts = entry.entryJws.split(".");
    const logPayload = logParts.length === 3 ? b64urlJson(logParts[1]) : null;
    const recordedAt = typeof logPayload?.ts === "string" ? logPayload.ts : entry.ts;
    const anchored = chain.anchoredSeq !== null && entry.seq <= chain.anchoredSeq;
    const baseEvent = {
      sequence: entry.seq,
      recordedAt,
      source: "unknown",
      tier: null as SvriHistoryEvent["tier"],
      issuer: null as string | null,
      attestationId: null as string | null,
      entryHash: await sha256B64Url(entry.entryJws),
      anchored,
    };
    const addEvent = (accepted: boolean, reason?: string, claims?: SvriAttestationClaims, tier?: SvriHistoryEvent["tier"]) => {
      const snapshot: SiteSnapshotLike = {
        siteId: input.siteId,
        self: [...self.values()],
        agent: [...agent.values()],
        community: [...community.values()],
        escrowReports: [...escrowReports.values()],
      };
      const detail = buildSiteSvriDetail(snapshot, { readerConductRecords: [...readerConduct.values()] });
      events.push({
        ...baseEvent,
        source: claims?.src ?? "unknown",
        tier: tier ?? null,
        issuer: claims?.iss ?? null,
        attestationId: claims?.jti ?? null,
        accepted,
        ...(reason ? { reason } : {}),
        svri: detail.svri,
      });
    };

    if (typeof entry.attJws !== "string" || !entry.attJws) {
      partial = true;
      addEvent(false, "source_jws_missing_from_legacy_log");
      continue;
    }
    if (typeof logPayload?.att !== "string" || await sha256B64Url(entry.attJws) !== logPayload.att) {
      partial = true;
      addEvent(false, "source_jws_hash_mismatch");
      continue;
    }
    const parsed = parseAttestation(entry.attJws);
    if (!parsed) {
      partial = true;
      addEvent(false, "source_jws_invalid");
      continue;
    }
    const { claims } = parsed;
    if (claims.src !== "reader_conduct" && claims.sub !== siteDid) {
      partial = true;
      addEvent(false, "attestation_subject_mismatch", claims, sourceTier(claims.src));
      continue;
    }
    let sourceCheck: { verified: boolean; reason?: string };
    try { sourceCheck = await input.verifySource(entry.attJws, claims, typeof parsed.header.kid === "string" ? parsed.header.kid : null); }
    catch { sourceCheck = { verified: false, reason: "source_verification_unavailable" }; }
    if (!sourceCheck.verified) {
      partial = true;
      addEvent(false, sourceCheck.reason ?? "source_signature_unverified", claims, sourceTier(claims.src));
      continue;
    }

    const tier = sourceTier(claims.src);
    switch (claims.src) {
      case "self":
        if (typeof claims.val === "boolean") self.set(claims.cat, { category: claims.cat, declaredValue: claims.val, declaredBy: claims.iss, declaredAt: recordedAt, attestationJti: claims.jti, attestationJws: entry.attJws });
        break;
      case "agent":
        if (typeof claims.val === "boolean") agent.set(claims.cat, { category: claims.cat, verified: claims.val, agentKeyId: claims.iss, verifiedAt: recordedAt, attestationJti: claims.jti, attestationJws: entry.attJws });
        break;
      case "escrow_report":
        if (claims.val === true) escrowReports.set(`${claims.iss}:${claims.jti}`, { transactionOutcome: claims.cat, escrowProvider: claims.iss, reportedAt: recordedAt, attestationJti: claims.jti, attestationJws: entry.attJws });
        break;
      case "community": {
        const firstSeen = input.communityFirstSeen?.get(`${claims.iss}\u0000${claims.jti}`) ?? null;
        community.set(`${claims.iss}:${claims.jti}`, { category: claims.cat, score: Number(claims.val), iss: claims.iss, jti: claims.jti, iat: claims.iat, votedAt: recordedAt, emitterFirstSeenIat: firstSeen, attestationJws: entry.attJws });
        break;
      }
      case "reader_conduct":
        if (claims.iss === siteDid) readerConduct.set(claims.jti, { issuer: claims.iss, attestationId: claims.jti });
        break;
    }
    addEvent(true, undefined, claims, tier);
  }

  const detail = buildSiteSvriDetail({
    siteId: input.siteId,
    siteDid,
    self: [...self.values()],
    agent: [...agent.values()],
    community: [...community.values()],
    escrowReports: [...escrowReports.values()],
  }, { readerConductRecords: [...readerConduct.values()] });

  return {
    status: partial ? "partial" : "complete",
    chainValid: true,
    anchoredSeq: chain.anchoredSeq,
    unanchoredEntries: entries.length - (chain.anchoredSeq ?? 0),
    events,
    detail,
  };
}
