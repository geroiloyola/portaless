import canonicalize from "canonicalize";
import { LtpFailure, ResourceBudget } from "./budget";
import { canonicalBytes, digestJcs, utf8Text } from "./canonical";
import { jwsDigest, parseCompactJws } from "./jws";
import type {
  AcquisitionConfig,
  ApwTxtManifest,
  BootstrapProfile,
  ComposedResult,
  DnsJsonResponse,
  HistoryProof,
  LtpHandoff,
  LtpLocalReason,
  OperationContext,
  ProofPackage,
  PublicKeyRecord,
  ResolutionPackageResponse,
  RootObservation,
  TrustPolicy,
} from "./types";
import type { LtpTransport } from "./transport";

const TXT_TYPE = 16;
const HOP_TIMEOUT_MS = 3_000;
const IDENTITY_PROFILE = "apw-identity-proof-v1";
const MAX_HISTORY_KEYS = 16;
const MAX_HISTORY_ENTRIES = 400;

export interface AcquisitionInput {
  subject: string;
  requestId: string;
  bootstrapProfile: BootstrapProfile;
  config: AcquisitionConfig;
  policy: TrustPolicy;
  transport: LtpTransport;
  /** Injected monotonic clock in milliseconds. */
  now: () => number;
  /** Wall clock at operation start, in Unix seconds. */
  wallClockSeconds: number;
  operationId: string;
  clientScope: string;
  /** Reuse the composed resolution budget so signature attempts never reset at handoff. */
  budget?: ResourceBudget;
}

export interface AcquisitionSuccess {
  ok: true;
  handoff: LtpHandoff;
  consumed: [true, true];
}

export interface AcquisitionFailure {
  ok: false;
  reason: LtpLocalReason;
  stage: "A-DOH" | "A-PACKAGE";
  consumed: [boolean, boolean];
}

export type AcquisitionOutcome = AcquisitionSuccess | AcquisitionFailure;

function domainFromDid(subject: string): string {
  const match = /^did:apw:([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/.exec(subject);
  if (!match) throw new LtpFailure("unsupported_profile", "invalid did:apw subject");
  return match[1];
}

export function sortPublicKeys(keys: readonly PublicKeyRecord[]): PublicKeyRecord[] {
  return [...keys].sort((left, right) => {
    if (left.fingerprint !== right.fingerprint) return left.fingerprint < right.fingerprint ? -1 : 1;
    const a = left.keyId ?? "";
    const b = right.keyId ?? "";
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function stableTargetDigest(manifestJws: string): string {
  const parsed = parseCompactJws(manifestJws);
  if (!parsed || typeof parsed.payload.iat !== "number") {
    throw new LtpFailure("proof_mismatch", "manifest payload lacks integer iat");
  }
  const target: Record<string, unknown> = { ...parsed.payload };
  delete target.iat;
  return digestJcs(target);
}

function parseTxtManifest(data: string, domain: string): ApwTxtManifest {
  let text: string;
  let value: unknown;
  try {
    const first = JSON.parse(data);
    if (typeof first !== "string") throw new Error("TXT data is not a JSON string");
    text = first;
    value = JSON.parse(text);
  } catch {
    throw new LtpFailure("bootstrap_unsupported", "malformed TXT JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LtpFailure("bootstrap_unsupported", "TXT is not an object");
  }
  if (canonicalize(value) !== text) {
    throw new LtpFailure("not_canonical", "TXT manifest is not JCS");
  }
  const manifest = value as ApwTxtManifest;
  if (manifest.v !== 2) throw new LtpFailure("bootstrap_unsupported", "TXT manifest is not v2");
  if (manifest.siteId !== domain) throw new LtpFailure("bootstrap_unsupported", "TXT siteId mismatch");
  if (typeof manifest.k !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(manifest.k)) {
    throw new LtpFailure("bootstrap_unsupported", "TXT k is missing or malformed");
  }
  if (typeof manifest.h !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(manifest.h)) {
    throw new LtpFailure("bootstrap_unsupported", "TXT h is missing or malformed");
  }
  if (manifest.rg !== undefined && typeof manifest.rg !== "boolean") {
    throw new LtpFailure("bootstrap_unsupported", "TXT rg is not boolean");
  }
  if (!Array.isArray(manifest.contentKinds) || manifest.contentKinds.length === 0
    || manifest.contentKinds.some(kind => typeof kind !== "string" || !kind)) {
    throw new LtpFailure("bootstrap_unsupported", "TXT contentKinds is invalid");
  }
  if (typeof manifest.trustUrl !== "string" || !manifest.trustUrl.startsWith("/")) {
    throw new LtpFailure("bootstrap_unsupported", "TXT trustUrl is invalid");
  }
  return manifest;
}

function validateDnsForTxt(dns: DnsJsonResponse, domain: string): { manifest: ApwTxtManifest; ttl: number } {
  if (dns.Status !== 0) {
    if (dns.Status === 3) throw new LtpFailure("identity_not_found", "authenticated NXDOMAIN");
    throw new LtpFailure("service_unavailable", `DNS status ${dns.Status}`);
  }
  if (dns.TC === true) throw new LtpFailure("bootstrap_unsupported", "truncated DNS response");
  if (dns.AD !== true) throw new LtpFailure("dnssec_required", "AD is not true");
  const name = `_apw.${domain}.`;
  const question = dns.Question ?? [];
  if (question.length !== 1 || question[0].type !== TXT_TYPE || question[0].name.toLowerCase() !== name) {
    throw new LtpFailure("bootstrap_unsupported", "unexpected DNS question");
  }
  const answers = (dns.Answer ?? []).filter(answer => answer.type === TXT_TYPE
    && answer.name.toLowerCase() === name && Number.isSafeInteger(answer.TTL) && answer.TTL >= 0);
  if (answers.length === 0) throw new LtpFailure("identity_not_found", "no TXT answer");
  if (answers.length > 8) throw new LtpFailure("response_limit_exceeded", "too many DNS answers");
  const manifests = answers.map(answer => parseTxtManifest(answer.data, domain));
  const first = manifests[0];
  for (const manifest of manifests.slice(1)) {
    if (manifest.k !== first.k || manifest.h !== first.h || manifest.siteId !== first.siteId || manifest.trustUrl !== first.trustUrl) {
      throw new LtpFailure("bootstrap_ambiguous", "distinct TXT manifests disagree");
    }
  }
  return { manifest: first, ttl: Math.min(...answers.map(answer => answer.TTL)) };
}

function validatePackage(result: ResolutionPackageResponse, input: AcquisitionInput, domain: string): {
  packageBytes: Uint8Array;
  pkg: ProofPackage;
  history: HistoryProof;
  targetManifestDigest: string;
  keySetDigest: string;
} {
  if (result.typ !== "ltp-resolution-result" || result.version !== "0.1") {
    throw new LtpFailure("proof_mismatch", "invalid result envelope");
  }
  if (result.status !== "candidate" || result.reason !== null || !result.package) {
    throw new LtpFailure(result.status === "incomplete" ? "proof_incomplete" : "proof_mismatch", "no candidate package");
  }
  if (result.requestId !== input.requestId || result.subject !== input.subject) {
    throw new LtpFailure("proof_mismatch", "result does not match the request");
  }
  if (result.profile !== IDENTITY_PROFILE || result.bootstrapProfile !== input.bootstrapProfile) {
    throw new LtpFailure("unsupported_profile", "unsupported package profile");
  }
  const pkg = result.package;
  if (pkg.typ !== "ltp-proof-package" || pkg.version !== "0.1" || pkg.profile !== IDENTITY_PROFILE) {
    throw new LtpFailure("unsupported_profile", "unsupported container profile");
  }
  if (pkg.subject !== input.subject || pkg.bootstrapProfile !== input.bootstrapProfile) {
    throw new LtpFailure("proof_mismatch", "container subject/profile mismatch");
  }
  if (!Number.isSafeInteger(pkg.assembledAt) || !Number.isSafeInteger(pkg.expiresAt) || pkg.expiresAt <= pkg.assembledAt) {
    throw new LtpFailure("proof_mismatch", "container timestamps are invalid");
  }
  if (!Array.isArray(pkg.attestations) || pkg.attestations.length !== 0
    || !Array.isArray(pkg.issuerBindings) || pkg.issuerBindings.length !== 0 || pkg.calculation !== null) {
    throw new LtpFailure("unsupported_profile", "identity-only package contains other proof types");
  }
  if (!Array.isArray(pkg.identities) || pkg.identities.length !== 1) {
    throw new LtpFailure("unsupported_profile", "exactly one subject identity is required");
  }
  const identity = pkg.identities[0];
  if (identity.did !== input.subject || identity.didDocument?.id !== input.subject) {
    throw new LtpFailure("proof_mismatch", "identity subject mismatch");
  }
  if (identity.manifestJws.split(".").length !== 3) throw new LtpFailure("proof_mismatch", "manifest JWS missing");
  if (!Array.isArray(identity.dnsMessages) || identity.dnsMessages.length !== 0) {
    throw new LtpFailure("unsupported_profile", "independent-DoH package must not carry offline DNS messages");
  }
  if (!Array.isArray(identity.didDocument.verificationMethod) || identity.didDocument.verificationMethod.length === 0) {
    throw new LtpFailure("proof_mismatch", "DID document has no verification method");
  }
  if (!identity.historyRef) throw new LtpFailure("proof_incomplete", "identity has no history reference");
  const histories = pkg.histories.filter(history => history.id === identity.historyRef);
  if (histories.length !== 1 || histories[0].did !== input.subject) {
    throw new LtpFailure("proof_mismatch", "history reference does not resolve uniquely");
  }
  const history = histories[0];
  if (history.format !== "full" || history.checkpointRef !== null || history.startSeq !== 1) {
    throw new LtpFailure("checkpoint_required", "only a full identity history is enabled");
  }
  if (!Array.isArray(history.keys) || history.keys.length === 0 || history.keys.length > MAX_HISTORY_KEYS) {
    throw new LtpFailure("response_limit_exceeded", "history key list exceeds the approved bound");
  }
  if (!Array.isArray(history.entries) || history.entries.length > MAX_HISTORY_ENTRIES) {
    throw new LtpFailure("response_limit_exceeded", "history entries exceed the approved bound");
  }
  if (!history.terminal || !Number.isSafeInteger(history.terminal.seq) || history.terminal.seq !== history.entries.length) {
    throw new LtpFailure("proof_incomplete", "terminal does not cover the supplied entries");
  }
  for (let index = 0; index < history.entries.length; index += 1) {
    const entry = history.entries[index];
    if (entry.seq !== index + 1 || typeof entry.jws !== "string" || entry.jws.split(".").length !== 3) {
      throw new LtpFailure("seq_gap", "history entries are not consecutive");
    }
  }
  if (history.entries.length === 0) {
    if (history.terminal.seq !== 0 || history.terminal.hash !== null) throw new LtpFailure("proof_incomplete", "empty history terminal");
  } else if (history.terminal.hash !== jwsDigest(history.entries[history.entries.length - 1].jws)) {
    throw new LtpFailure("proof_mismatch", "terminal hash does not match the last entry");
  }
  const packageBytes = canonicalBytes(pkg);
  if (packageBytes.length > input.config.limits.packageBytes) {
    throw new LtpFailure("response_limit_exceeded", "package exceeds maxPackageBytes");
  }
  return {
    packageBytes,
    pkg,
    history,
    targetManifestDigest: stableTargetDigest(identity.manifestJws),
    keySetDigest: digestJcs(sortPublicKeys(history.keys)),
  };
}

export async function acquireIdentity(input: AcquisitionInput): Promise<AcquisitionOutcome> {
  const consumed: [boolean, boolean] = [false, false];
  let stage: "A-DOH" | "A-PACKAGE" = "A-DOH";
  const budget = input.budget ?? new ResourceBudget(input.config.limits, input.now);
  try {
    const domain = domainFromDid(input.subject);
    if (input.config.profile !== "configured-doh-and-index") {
      throw new LtpFailure("unsupported_profile", "unsupported acquisition profile");
    }
    if (input.config.redirects !== 0) throw new LtpFailure("bootstrap_unsupported", "redirects must be zero");
    if (!input.policy.resolverIds.includes(input.config.resolverId)) {
      throw new LtpFailure("unsupported_profile", "resolver is not operator-configured");
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.requestId)) throw new LtpFailure("unsupported_profile", "invalid requestId");
    const now = () => input.now();
    const hopTimeout = () => Math.min(HOP_TIMEOUT_MS, Math.max(1, input.config.limits.deadlineMs - now()));

    const dohUrl = `${input.config.doh}?name=_apw.${domain}&type=TXT&do=1&cd=0`;
    const dohReservation = budget.reserveHttp(input.config.limits.dohBytes, "A-DOH");
    consumed[0] = true;
    const dohResponse = await input.transport.send({
      method: "GET",
      url: dohUrl,
      headers: { accept: "application/dns-json" },
      maxBytes: input.config.limits.dohBytes,
      timeoutMs: hopTimeout(),
      stage: "A-DOH",
    });
    dohReservation.settle(dohResponse.body.byteLength);
    if (dohResponse.status !== 200 || dohResponse.tlsAuthenticated !== true) {
      throw new LtpFailure("service_unavailable", "DoH response is not an authenticated 200");
    }
    if (dohResponse.resolverId !== undefined && dohResponse.resolverId !== input.config.resolverId) {
      throw new LtpFailure("bootstrap_unsupported", "unexpected resolver identity");
    }
    let dns: DnsJsonResponse;
    try {
      dns = JSON.parse(utf8Text(dohResponse.body)) as DnsJsonResponse;
    } catch {
      throw new LtpFailure("bootstrap_unsupported", "malformed DNS-JSON body");
    }
    const { manifest, ttl } = validateDnsForTxt(dns, domain);

    stage = "A-PACKAGE";
    const request = {
      bootstrapProfile: input.bootstrapProfile,
      checkpointIds: [] as string[],
      limits: {
        deadlineMs: input.config.limits.deadlineMs,
        maxPackageBytes: input.config.limits.packageBytes,
        maxSignatureVerifications: input.config.limits.signatureAttempts,
      },
      profile: IDENTITY_PROFILE,
      requestId: input.requestId,
      resume: [] as unknown[],
      subject: input.subject,
      typ: "ltp-resolution-request",
      version: "0.1",
    };
    const packageCap = Math.min(input.config.limits.packageBytes,
      input.config.limits.bodyBytes - budget.bodyBytesUsed);
    const packageReservation = budget.reserveHttp(packageCap, "A-PACKAGE");
    consumed[1] = true;
    const indexResponse = await input.transport.send({
      method: "POST",
      url: input.config.index,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: canonicalBytes(request),
      maxBytes: packageCap,
      timeoutMs: hopTimeout(),
      stage: "A-PACKAGE",
    });
    packageReservation.settle(indexResponse.body.byteLength);
    if (indexResponse.status !== 200 || indexResponse.tlsAuthenticated !== true) {
      throw new LtpFailure("service_unavailable", "Index response is not an authenticated 200");
    }
    let result: ResolutionPackageResponse;
    try {
      result = JSON.parse(utf8Text(indexResponse.body)) as ResolutionPackageResponse;
    } catch {
      throw new LtpFailure("proof_mismatch", "malformed Index JSON");
    }
    const validated = validatePackage(result, input, domain);
    if (result.packageDigest !== digestJcs(validated.pkg)) {
      throw new LtpFailure("proof_mismatch", "packageDigest does not match the package");
    }

    const elapsedAtHandoffMs = budget.elapsedMs();
    if (elapsedAtHandoffMs >= input.config.limits.deadlineMs) {
      throw new LtpFailure("deadline_exceeded", "deadline reached before handoff", "A-PACKAGE");
    }
    const context: OperationContext = {
      operationId: input.operationId,
      clientScope: input.clientScope,
      rootScope: domain,
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: input.config.limits.deadlineMs,
      httpAttemptsUsed: budget.httpAttemptsUsed,
      bodyBytesUsed: budget.bodyBytesUsed,
      signatureAttemptsUsed: 0,
      policyDigest: digestJcs(input.policy),
      configDigest: digestJcs(input.config),
    };
    const root: RootObservation = {
      did: input.subject,
      manifest,
      profile: input.bootstrapProfile,
      resolverId: input.config.resolverId,
      channel: input.transport.channel,
      receivedAt: input.wallClockSeconds,
      validUntil: input.wallClockSeconds + ttl,
      rootManifestDigest: digestJcs(manifest),
      observation: "independent-online",
    };
    const handoff: LtpHandoff = {
      subject: input.subject,
      requestId: input.requestId,
      packageBytes: validated.packageBytes,
      packageDigest: result.packageDigest,
      root,
      context,
      targetManifestDigest: validated.targetManifestDigest,
      keySetDigest: validated.keySetDigest,
      elapsedAtHandoffMs,
      remainingAtHandoffMs: input.config.limits.deadlineMs - elapsedAtHandoffMs,
    };
    return { ok: true, handoff, consumed: [true, true] };
  } catch (error) {
    const failure = error instanceof LtpFailure
      ? error
      : new LtpFailure("service_unavailable", `acquisition failed: ${(error as Error).message}`);
    return { ok: false, reason: failure.reason, stage, consumed };
  }
}

export function acquisitionFailureResult(failure: AcquisitionFailure, budget?: ResourceBudget): ComposedResult {
  return {
    identity: "unverified",
    history: "not_started",
    proofAccepted: false,
    reason: failure.reason,
    stopsBefore: failure.consumed[0] ? (failure.consumed[1] ? "B-BINDINGS" : "A-PACKAGE") : "A-DOH",
    resourceGrant: false,
    reputationAdmitted: false,
    implementationAuthorized: false,
    misconduct: false,
    arbitraryOriginCalls: 0,
    acquisitionConsumed: failure.consumed,
    logSlicesConsumed: [false, false, false],
    semanticVerdictObserved: false,
    signatureAttemptsConsumed: budget?.signatureAttemptsUsed ?? 0,
    effectiveValidUntil: null,
  };
}
