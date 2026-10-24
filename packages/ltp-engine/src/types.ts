export type BootstrapProfile = "independent-doh-ad-v1" | "dnssec-offline-v1";
export type ProofProfile = "apw-identity-proof-v1" | "ltp-site-log-proof-v1" | "ltp-reader-conduct-proof-v1";

/** Hard ceilings from the approved D7 resource table. A caller may configure lower values. */
export interface LtpLimits {
  bodyBytes: number;
  dohBytes: number;
  packageBytes: number;
  signatureAttempts: number;
  httpAttempts: number;
  deadlineMs: number;
}

export const APPROVED_LIMITS: Readonly<LtpLimits> = Object.freeze({
  bodyBytes: 4 * 1024 * 1024,
  dohBytes: 64 * 1024,
  packageBytes: 512 * 1024,
  signatureAttempts: 640,
  httpAttempts: 24,
  deadlineMs: 10_000,
});

export interface TrustPolicy {
  clockSkewSeconds: number;
  fallbackOnTransportFailure: boolean;
  maxSnapshotAgeSeconds: number;
  resolverIds: readonly string[];
  rulesVersion: string;
}

export interface AcquisitionConfig {
  profile: string;
  doh: string;
  index: string;
  resolverId: string;
  redirects: number;
  sourceClock: string;
  localPolicyByteRef?: string;
  limits: LtpLimits;
}

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsJsonResponse {
  Status: number;
  TC?: boolean;
  AD?: boolean;
  Question?: Array<{ name: string; type: number }>;
  Answer?: DnsAnswer[];
}

export interface ApwTxtManifest {
  v: number;
  siteId: string;
  trustUrl: string;
  contentKinds: string[];
  k: string;
  h: string;
  rg?: boolean;
}

export interface PublicKeyRecord {
  keyId: string | null;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  validFrom: string;
  validTo: string | null;
}

export interface HistoryTerminal {
  seq: number;
  hash: string | null;
}

export interface HistoryEntry {
  seq: number;
  jws: string;
}

export interface HistoryProof {
  id: string;
  did: string;
  format: "full" | "continuation" | "bootstrap-segment";
  checkpointRef: string | null;
  startSeq: number;
  keys: PublicKeyRecord[];
  keySetJws: string;
  entries: HistoryEntry[];
  terminal: HistoryTerminal;
}

export interface IdentityProof {
  did: string;
  didDocument: {
    id: string;
    verificationMethod: Array<{
      id: string;
      type: string;
      controller: string;
      publicKeyJwk: JsonWebKey;
    }>;
  };
  manifestJws: string;
  dnsMessages: string[];
  historyRef: string | null;
}

export interface ProofPackage {
  typ: "ltp-proof-package";
  version: "0.1";
  profile: ProofProfile;
  subject: string;
  bootstrapProfile: BootstrapProfile;
  identities: IdentityProof[];
  histories: HistoryProof[];
  attestations: string[];
  issuerBindings: unknown[];
  calculation: null;
  assembledAt: number;
  expiresAt: number;
}

export interface ResolutionPackageResponse {
  typ: "ltp-resolution-result";
  version: "0.1";
  requestId: string;
  subject: string;
  profile: ProofProfile;
  bootstrapProfile: BootstrapProfile;
  status: string;
  package: ProofPackage | null;
  packageDigest: string | null;
  reason: string | null;
  retryAfterSeconds: number | null;
}

export interface RootObservation {
  did: string;
  manifest: ApwTxtManifest;
  profile: BootstrapProfile;
  resolverId: string;
  channel: string;
  receivedAt: number;
  validUntil: number;
  rootManifestDigest: string;
  observation: "independent-online";
}

export interface OperationContext {
  operationId: string;
  clientScope: string;
  rootScope: string;
  startedAtMonotonicMs: number;
  deadlineAtMonotonicMs: number;
  httpAttemptsUsed: number;
  bodyBytesUsed: number;
  signatureAttemptsUsed: number;
  policyDigest: string;
  configDigest: string;
}

export interface LtpHandoff {
  subject: string;
  requestId: string;
  packageBytes: Uint8Array;
  packageDigest: string;
  root: RootObservation;
  context: OperationContext;
  targetManifestDigest: string;
  keySetDigest: string;
  elapsedAtHandoffMs: number;
  remainingAtHandoffMs: number;
}

export interface PrefixState {
  did: string;
  seq: number;
  hash: string | null;
  rootManifestDigest: string;
  targetManifestDigest: string;
  keySetDigest: string;
  trustPolicyDigest: string;
  context: OperationContext;
  trustClass: "quarantined-proposal";
}

export interface DeclaredSlice {
  id: string;
  input: PrefixState;
  output: PrefixState;
}

export type IdentityStatus = "verified" | "unverified" | "unavailable";
export type HistoryStatus = "verified" | "partial" | "invalid" | "not_started";

export type LtpLocalReason =
  | "dnssec_required"
  | "key_mismatch"
  | "bad_signature"
  | "checkpoint_required"
  | "deadline_exceeded"
  | "freshness_unproven"
  | "bootstrap_ambiguous"
  | "bootstrap_unsupported"
  | "identity_not_found"
  | "ssrf_blocked"
  | "service_unavailable"
  | "proof_incomplete"
  | "proof_mismatch"
  | "seq_gap"
  | "prev_mismatch"
  | "ts_outside_key_window"
  | "ts_regression"
  | "not_canonical"
  | "budget_exhausted"
  | "response_limit_exceeded"
  | "unsupported_profile";

export interface ComposedResult {
  identity: IdentityStatus;
  history: HistoryStatus;
  proofAccepted: boolean;
  reason: LtpLocalReason | null;
  stopsBefore: string | null;
  resourceGrant: false;
  reputationAdmitted: false;
  implementationAuthorized: false;
  misconduct: false;
  arbitraryOriginCalls: 0;
  acquisitionConsumed: [boolean, boolean];
  logSlicesConsumed: [boolean, boolean, boolean];
  semanticVerdictObserved: false;
  signatureAttemptsConsumed: number;
  effectiveValidUntil: number | null;
}
