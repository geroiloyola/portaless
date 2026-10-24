# LTP Index — Draft 0.1

**Status:** owner-approved Draft 0.1 contract baseline (2026-10-23); final normative
publication and runtime conformance pending the [standardization gates](./LTP-STANDARDIZATION-STATUS.md).
Not an adopted APW v1.3 endpoint or implemented federation feature. **License:** CC BY 4.0.

Requirement words follow RFC 2119/RFC 8174. This specification is independent
of programming language, vendor, hosting platform and reference runtime.

## 1. Roles and non-authority

This service belongs to the trust/traceability layer of the
[LTP Stack](./LTP-STACK-ARCHITECTURE.md). APW provides its identity/state input;
SVRI/HSVR are current/historical outputs of LTP verification and calculation.

An **LTP Index** distributes
[LTP Proof Packages](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md). It may collect/cache
public or explicitly authorized source data. It does not create subject identity,
issuer trust, grants, reputation sources or a universally latest global state.
Multiple independently operated services may implement the same contract.

An operator configures exact HTTPS endpoint(s), trust policy and optional service
credentials. The protocol defines no mandatory global directory, vendor URL,
account or proprietary format. Availability, endpoint authentication, data
integrity, source authenticity and authorization are separate properties.

The canon for a subject's data remains with its owner. A cached public content
projection or Git hash is not automatically an LTP Proof Package. Distribution
must preserve original signed artifacts and the audience allowed to receive them.

## 2. Endpoint and request

Exact request/result schemas and null/retry/HTTP combinations are in the
[S1 serialization candidate](./LTP-SERIALIZATION-DRAFT-v0.1.md).

The operator configures the complete HTTPS URL; its path is not an identity root.
Consumers MUST NOT derive an endpoint from a requester, subject TXT/DID, package
field, discovery hint or redirect without a separate operator configuration act.
No query parameter may choose an upstream URL. Redirects are disabled.

Use POST with `Content-Type: application/json` and `Accept: application/json`.
Request objects contain exactly:

| Field | Rule |
|---|---|
| `typ` | `ltp-resolution-request`. |
| `version` | `0.1`. |
| `requestId` | Unpadded base64url encoding of 32 consumer-generated random bytes. Correlation, not proof of freshness. |
| `subject` | Canonical `did:apw:<domain>`; data, not a transport URL. |
| `profile` | Requested LTP Proof Package profile. |
| `bootstrapProfile` | Locally selected independent DoH/AD or offline DNSSEC profile; no automatic downgrade. |
| `checkpointIds` | Array of up to 3 checkpoint digests already held by the consumer, or empty. A checkpoint ID does not export credentials or constitute a grant. |
| `resume` | Array of up to 3 Resume descriptors derived from local quarantined bootstrap progress under the package contract, unique by DID; empty for fresh requests. These are acquisition hints, not trusted checkpoints. |
| `limits` | `{maxPackageBytes,maxSignatureVerifications,deadlineMs}`: positive safe integers within local policy. All nested work shares the same resolution budget. |

The service applies the minimum of client-requested and its own authenticated
service/acquisition limits. Client limits never increase server permissions or
authorize collection. Reject malformed subjects, unsupported versions/profiles
and excessive requests before acquisition. Default acquisition is not an open
on-demand proxy: its operator must choose allowed collection behavior and quotas.

Service authentication may be operator-provisioned bearer credentials or a
separately specified signed-request profile over HTTPS; neither is an identity
root for the subject. Credentials must be audience-scoped to this service, never
forwarded to subjects, put in URLs, included in packages or emitted in logs.
Restricted proof retrieval requires authorization, not merely possession of a
subject DID. An implementation must not advertise an undefined signed-request
scheme as conformant or turn it on via request input.

## 3. Response schema

JSON responses contain exactly:

- `typ`: `ltp-resolution-result`;
- `version`: `0.1`;
- `requestId`, `subject`, `profile`, `bootstrapProfile`: exact request binding;
- `status`: `candidate`, `incomplete`, `no_data`, `unsupported`, `unavailable`,
  `denied` or `limit_exceeded`;
- `package`: LTP Proof Package or null;
- `packageDigest`: JCS SHA-256 digest of `package`, or null when package is null;
- `reason`: registered code below, or null for a candidate;
- `retryAfterSeconds`: positive integer only for transient/retryable results,
  otherwise null.

`candidate` means a package is offered **for verification**, not that it is valid.
`incomplete` may carry partial proof data for quarantined progress; it does not
authorize identity or scoring. `no_data` means the Index has no proof to offer;
it does not prove domain nonexistence, lack of misconduct or neutral reputation.
Do not infer authenticity from HTTP status, a package digest or an Index receipt.

HTTP mapping for this draft:

| Result | HTTP | Rule |
|---|---|---|
| candidate / incomplete / no_data | 200 | Consumer must still verify; incomplete/no-data is not positive trust. |
| malformed request / unsupported | 400 | Stable reason; no hidden fallback to another format. |
| denied | 401 or 403 | Service authentication/authorization, not subject reputation. |
| client service quota | 429 | Retry-After if retryable. |
| unavailable | 503 | Operational failure, retry data if meaningful. |
| limit_exceeded | 413 for request size; otherwise 503 | Identify the public limit class, without internal state. |

These are service errors. They do not rewrite a protected resource's existing
identity/policy HTTP contract. For example a consumer's directory-redirect 401
without Retry-After remains distinct from an Index service outage.

Consumers verify response binding, canonical digest and package version before
expensive proof evaluation. Matching `requestId` only binds a response to the
request over its transport; it cannot prove that DNS, history or reputation was
observed at that instant. A malicious Index may correctly echo it with old data.

## 4. Consumer validation procedure

1. Enforce endpoint, response-body, object/array, decompressed-byte and deadline
   limits. Cancel on overflow; do not buffer an unbounded body to check afterward.
2. Validate request/result binding and `packageDigest`. Do not follow data URLs
   or treat new endpoints inside proofs as configured services.
3. Obtain independent roots using
   [APW Identity Bootstrap](./APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md). With the online
   profile this is a separate bounded query to a preconfigured DoH provider,
   never one nominated by the Index. With the offline profile verify all DNSSEC
   locally using existing trust anchors; no subject/issuer network calls.
4. Verify APW identities, artifact bytes, chain continuity/anchors and key windows,
   then LTP Attestations and the requested SVRI Projection under the package
   contract. A valid subject signature alone does not reproduce a projection.
5. Apply independent-root/proof/key/caching expiry and known-state rollback rules.
   Incomplete or expired proofs cannot satisfy a verification-required policy.
6. Apply resource authorization separately, using current policy/grants. An Index
   cannot grant access by returning a high level, a category or `candidate`.

If a needed proof is missing, return pending/incomplete/unavailable as appropriate;
do not complete the package by fetching an arbitrary subject/witness/issuer.
An optional private relay must be a separately configured acquisition route with
its own verified pinning/authentication/replay/budget contract. No runtime is
required to operate a relay to implement this consumer or to serve public content.

## 5. Bounded long-history progress

Large histories must not be mislabeled bad signatures merely because they exceed
one response/verification step. The full/continuation contracts in LTP Proof
Package separate trusted checkpoints from incomplete bootstrap progress.

For an already trusted checkpoint, request its digest; the service can offer a
continuation to the same independently authenticated target. A consumer must
not import an Index-supplied checkpoint as trusted. It must preserve budgets
across service retries, package evaluation and issuer/bootstrap work.

For cold bootstrap that cannot fit one package, return `incomplete` with
`bootstrap-segment` HistoryProof data under the package contract. The consumer
validates the bounded slice against its quarantined local prefix, derives its
own Resume descriptor and supplies it on a later request to the same configured
service (or an explicitly selected compatible one). The descriptor cannot
install a root, import trusted progress or authorize the subject. A service may
offer a full package instead, within limits; the consumer independently checks it.

Keep subject, independent root, signed target, key-set digest and rules fixed
across segments. Changed/expired dependencies need revalidation or restart;
reaching an entry count without reaching the authenticated target is not success.
Return `history_step_limit` for a bounded pending step and `checkpoint_required`
for an unknown trusted continuation checkpoint; do not repeatedly call the first
page complete or describe a merely incomplete chain as cryptographically invalid.
No ad hoc cursor URL, silent relaxation or unbounded background work is allowed.

## 6. Freshness, distribution and adversarial behavior

- The Index may withhold data, return different candidates or replay an older
  still-valid package. Cryptography does not prove global availability/latestness.
  Expiry/known-state rollback checks reduce replay; independent witnesses and
  comparison across services can expose discrepancies, not guarantee consensus.
- Service TLS/signatures authenticate a service, not the subject DNS root or
  truth of its claims. An offline DNSSEC proof is bounded by signature validity;
  a forwarded JSON AD flag cannot replace an independent online observation.
- An Index must state acquisition/cache times as declarations, not proof of fresh
  DNS observation. Consumers inherit dependency expiry; no stale-on-error and
  no resetting TTL by repackaging old proof.
- Public distribution is restricted to approved public artifacts. Proofs that
  reveal governed data, full administrative SVRI or HSVR require appropriate
  origin/deployment authorization. A package's `public` label, if introduced in
  a later version, could not grant publication rights by itself.
- Restricted responses use private/no-store caching. Public candidates may use
  a shorter configured cache lifetime, never extending their dependency validity.
  Cache keys must distinguish subject, package/bootstrap/rules profile and audience;
  service errors must not be cached as proof of missing identity or misconduct.
- The acquisition side must use validated-address connectors, blocked ranges,
  hostname-correct TLS, streaming limits and explicit redirects/budgets. Serving
  through an Index moves acquisition; it does not eliminate that responsibility.

## 7. Reasons, portability and implementation isolation

Core service reasons: `invalid_request`, `unsupported_version`,
`unsupported_profile`, `authentication_required`, `access_denied`,
`proof_not_available`, `proof_incomplete`, `checkpoint_required`,
`history_step_limit`, `service_unavailable`, `budget_exhausted`,
`request_too_large`, `response_limit_exceeded` and `deadline_exceeded`.
Crypto/identity reasons are produced by local verification and must not be
collapsed into a service's claim. No secret, raw client IP, private proof or
remaining internal quota is exposed in public reason fields.

An Index must preserve the subject's `apw-key-set+jws` artifact with history
packages. It cannot create that subject binding or authorize retired key windows
by signing its own metadata. Existing unsigned witness directories/key arrays
alone cannot satisfy the new proof profile.

Independent implementations must agree on canonical bytes/digests, bootstrap
provenance, accepted identity/key binding, chain result, admissible evidence,
SVRI recomputation and failure class for the same declared inputs/trust policy.
No field, URL, algorithm or result depends on a particular runtime's module,
database, language class or private API. Runtime adapters only supply transport,
storage, clock, crypto and authorization under the declared contracts.

## 8. Adoption gate

The owner's architectural baseline and S1–S6 milestones are recorded in
[standardization status](./LTP-STANDARDIZATION-STATUS.md). Implementation
permissions are defined only in the [canonical G1–G5 register](./LTP-GATES-AND-AUTHORIZATIONS.md);
baseline/corpus approval or merge does not open an implementation phase. The
G2/G3 identity-only work required and received a separate owner decision.
The following conformance requirements remain mandatory.

Before any production Edge route advertises these profiles, publish independent
machine-readable vectors for all three draft contracts; validate them with at
least two independent verifiers; test request limits, no arbitrary-origin calls,
malicious Index substitution/omission/AD/replay, bootstrap revocation semantics,
private audience handling, signature-count limits and every error class.

Use controlled local HTTPS/DNS fixtures for slow headers/body, redirect cycles,
oversized packages and valid/invalid keys/chains. Share one harness and prove
production modules cannot import it. Measure acquisition and consumer verification
separately; CPU-only local measurements are not deployed-runtime latency claims.

This draft introduces new `ltp-resolution-*` messages and `ltp-proof-package`.
It does **not** redefine the existing plain `typ: apw-index` witness directory,
turn an unsigned content projection into signed proof, or amend LTP/SVRI rules
without the protocol's explicit adoption/versioning process.
