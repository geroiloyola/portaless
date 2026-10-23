# APW Identity Bootstrap — Draft 0.1

**Status:** owner-approved Draft 0.1 contract baseline (2026-10-23); final normative
publication pending the [standardization gates](./LTP-STANDARDIZATION-STATUS.md).
Not an adopted amendment to APW v1.3.
**License:** CC BY 4.0, as for the APW specification.

MUST, MUST NOT, SHOULD and MAY have the meanings in RFC 2119/RFC 8174. They
describe conformance to this draft, not functionality already shipped. No
reference-runtime source code is required to interpret this contract.

## 1. Purpose and trust boundary

This is the identity-root contract of the [LTP Stack](./LTP-STACK-ARCHITECTURE.md).
APW owns identity/structure; LTP consumes the resulting proofs to evaluate trust.

An LTP Index transports data. It MUST NOT establish the subject's
identity merely by supplying a key and a signature made with that key. The
consumer MUST authenticate `_apw.<domain>` independently under one of the
profiles below, then enforce APW v1.3 §5.1: the subject's DID/key and TXT `k`
must agree. A missing root is not a negative reputation observation.

An operator chooses the profile and its trust configuration before resolution.
Neither the requester nor an LTP Proof Package can change that choice. Failure
MUST NOT trigger a downgrade, unsigned DNS fallback, or arbitrary-origin fetch.
An independent issuer using `did:apw` requires the same bootstrap, not just the
subject's signature over an issuer key.

This contract separates:

- **DNS authenticity:** why the consumer accepts the TXT/key binding;
- **observation:** when and through which trusted channel the consumer received it;
- **freshness:** how long it remains acceptable under signatures, TTL and policy;
- **authorization:** a separate decision that DNS authenticity never grants.

## 2. Shared parsing and binding rules

The [S1 serialization candidate](./LTP-SERIALIZATION-DRAFT-v0.1.md) fixes the
TXT-manifest commitment input. The [S3 corpus](./vectors/ltp/v0.1/README.md)
provides independent-online context and real offline DNSSEC fixture bytes for
algorithms 8, 13 and 15; broader negative coverage remains an adoption gate.

The input domain MUST be a lowercase ASCII DNS A-label name, without scheme,
port, trailing dot, user information, query or fragment. The complete
`_apw.<domain>` name MUST fit DNS length constraints. IDNA conversion, if offered
by a UI, occurs before this contract; different Unicode spellings MUST NOT
become independent cache/quota identities.

The query type is TXT/IN. Only TXT data for the exact question is admissible.
Draft 0.1 does not follow CNAME/DNAME or additional URLs; unsupported indirection
returns `bootstrap_unsupported`, not another unbudgeted lookup. Concatenate TXT
character-strings in RR order within each record; distinct records remain
distinct. Parse APW manifest v2 using APW v1.3 rules. Multiple distinct valid
manifests that disagree on `k`, `h`, site identity or trust URL MUST fail as
`bootstrap_ambiguous`; response order is not a tie-breaker for identity.

The consumer checks negative/error DNS status, exact question and type, complete
message structure and configured byte/record limits. A hash named `k` without
the authenticated TXT and matching key is insufficient. Missing/unsigned AD is
never converted into an authenticated empty record.

## 3. Profile `independent-doh-ad-v1`

### Operator trust configuration

The consumer has a closed, ordered list of HTTPS DoH endpoints. The protocol
defines **no vendor, mandatory service, default global endpoint or account**.
An endpoint consists of an exact HTTPS origin/path and an operator-assigned
identifier. Reject user information, fragments, private literals and requester-
supplied endpoint/query parameters. The adapter constructs only the question,
type and approved DNSSEC parameters. Do not follow redirects.

Trust assumptions are the configured recursive resolver's DNSSEC validation,
the authenticated HTTPS channel and the consumer clock. An endpoint may be
self-operated. A fixed endpoint does not prove socket IP or remove platform
networking assumptions; it is an explicit trusted bootstrap destination, not an
exception allowing fetch to the subject or an Index-nominated resolver.

### Validation

1. The consumer itself queries the selected endpoint, requesting DNSSEC-aware
   validation (`do=1`, `cd=0` for the DNS-JSON interface). Use the same bounded
   chain budget/deadline and source/subject context as the resolution operation.
2. Accept only an authenticated HTTPS response to this query; require a valid
   DNS-JSON object with `TC: false`, `AD: true` and the exact TXT/IN `Question`.
   Positive data requires `Status: 0` and a bounded `Answer` with nonnegative
   integral TTL values. Authenticated NXDOMAIN (`Status: 3`) or authenticated
   no-TXT (`Status: 0`, no matching answer) yields absence, not positive data.
   A transport profile that cannot provide these fields is unsupported, not
   silently equivalent. NXDOMAIN/no TXT returns `identity_not_found`, with no
   authorization or reputation implication. SERVFAIL/invalid structure fails.
3. Apply §2 and APW manifest validation; retain the selected `k`, `h`, manifest
   and the resolver identifier. Do not accept a TXT/AD value copied into an
   Index response as if it came from this HTTPS query.
4. A second operator-configured provider MAY be tried only after a transport
   failure if policy permits and quota remains. AD=false, bogus/ambiguous DNS
   or an identity mismatch MUST NOT trigger a more permissive fallback.
5. A resolver that resolves successfully but fails DNSSEC requirements yields
   `dnssec_required`; it does not yield `signature_invalid` for the caller.

The result is **provider-validated DNSSEC over trusted HTTPS**, not DNSSEC
validated locally by the consumer. The provider can lie or serve its valid
cache; its trust and propagation latency MUST be declared.

## 4. Profile `dnssec-offline-v1`

**Scope clarification — Draft review:** the minimal Draft delivery is §3's AD
bit from an operator-configured validating resolver over authenticated DoH.
Offline validation is an **optional, not-yet-supported conformance target** and
may only use an audited/reviewed third-party DNSSEC library with owner approval
of the adapter, anchor/algorithm policy and evidence. Do not implement a custom
production DNSSEC validator without the owner's explicit approval. No library
security audit or production adapter approval is claimed by this corpus.

Outside the minimal delivery: complete **DS delegation-chain** validation and
anchor management, authenticated denial via **NSEC/NSEC3**, **wildcard** processing,
and **algorithm rotation/rollover**. The requirements below describe what an
eventual advertised offline profile must prove, not implemented Draft support.
The fixture tools only check signatures/selected byte bindings on a synthetic
chain; they cannot supply these missing validation/policy guarantees. Return
unsupported/incomplete rather than accepting a partial chain as a live root.

### Proof input and local trust

The package carries `dnsMessages`, an array of unpadded base64url DNS wire
messages sufficient to prove the exact TXT RRset and its delegation/key chain.
Messages and their AD bits are untrusted input. The consumer uses independently
configured DNSSEC trust anchors, algorithm policy and trusted time. A package
MUST NOT install/replace a trust anchor, choose the clock or enable an algorithm.

The proof consists of TXT/RRSIG, needed DNSKEY/RRSIG and DS/RRSIG RRsets, and
any authenticated denial material needed to evaluate the chain. Their order in
the array is irrelevant. Conflicting records/proofs MUST fail; bounds apply to
messages, decoded bytes, records, key imports and cryptographic operations.

### Validation

Perform DNSSEC validation per RFC 4033/4034/4035 and applicable algorithm/time
processing rules, including canonical RRset signing data, owner/class/type,
signer scope, label/wildcard rules, DNSKEY flags/protocol, DS digest/key binding,
RRSIG validity and authenticated delegation/denial. Unsupported algorithms or
missing delegations return an unsupported/incomplete result, never success.
Insecure delegations and bogus chains cannot satisfy D1. Draft 0.1 §2 rejects
an aliased question rather than chasing or accepting another name's TXT.

Consumers advertising this profile MUST support DNSSEC algorithms 8
(RSA/SHA-256, RSA modulus at least 2048 bits), 13 (ECDSA P-256/SHA-256) and 15
(Ed25519), and DS digest type 2 (SHA-256). Other algorithms/digests require an
explicit compatible policy; SHA-1-only validation is not a fallback. These are
**draft interoperability requirements**, not claims about an existing verifier.
An implementation unable to provide this profile MUST report it unsupported.

Do not resolve missing proof URLs, DNS servers, issuers or subjects during local
validation. A complete offline package plus existing trust anchors/checkpoints
must be evaluated with zero consumer network connections. Network acquisition
belongs to the configured LTP Index or other acquisition service,
under its own safe transport and quotas.

### Authenticity is not an online freshness oracle

A replayed DNSSEC RRset may remain cryptographically valid until its signatures
expire. Local receipt time or an Index `fetchedAt` does not prove it is the
latest published DNS state. The consumer MUST expose `observation: offline` and
the verified signature-validity bound; it MUST NOT call this a fresh online DNS
observation or promise a short revocation bound from publication time.

If policy requires an independent current observation, this profile alone is
insufficient: return `freshness_unproven` or use a separately configured profile
through a new explicit request. Do not silently change trust profiles. Rollback
against a known verified checkpoint MUST still be rejected.

## 5. Local result and expiry

An accepted local root contains: `did`, `domain`, `manifest`, `keyFingerprint`,
`anchorHead`, `profile`, `trustConfigDigest`, `receivedAt`, `validUntil`,
`observation` (`independent-online` or `offline`) and `limitations`.
This is a **consumer-produced result**, not a structure the consumer accepts as
verified from an Index. `trustConfigDigest` identifies canonical local trust
configuration, excluding credentials; no secret appears in a result or log.

For an independent-online result, freshness ends no later than the minimum of
the local cache ceiling and the remaining TTL of every accepted DNS dependency.
For an offline result, bound acceptance by local receipt-cache policy and every
required RRSIG expiry, and preserve the offline freshness limitation above.
Never restart those bounds on cache hits or by rewrapping the same local result.
Key/proof validity can only shorten acceptance. No stale-on-error.

Revocation latency includes upstream DNS caches/signature validity and local
acceptance, not just a local timer. Offline proofs may be replayed while valid;
a new receipt of old valid bytes cannot establish a newer observation. Time
uncertainty cannot extend acceptance. Authentication timestamps use trusted wall
time; local TTL/deadline durations use the runtime's elapsed-time contract.

## 6. Outcomes and mandatory negative cases

Outcomes distinguish `authenticated`, `identity_not_found`, `dnssec_required`,
`bootstrap_ambiguous`, `bootstrap_unsupported`, `bootstrap_incomplete`,
`bootstrap_invalid`, `freshness_unproven`, `transport_unavailable`,
`budget_exhausted`, `limit_exceeded` and `deadline_exceeded`.
Only `authenticated` can supply an identity root. Authenticated absence does
not verify an identity, and an infrastructure failure is not misconduct.

Conformance vectors MUST cover: fake forwarded AD; wrong question/name/type;
multiple conflicting APW TXT records; bogus/unsigned/insecure delegations;
expired/future RRSIG; substituted DS/DNSKEY/TXT; wildcard/alias confusion;
unsupported algorithms; truncated/oversized wire data; malicious trust-anchor
replacement; replay still valid but not demonstrably current; resolver fallback
downgrade; local clock/TTL boundaries; and the same accepted `k`/`h` obtained
through both profiles with their different provenance/freshness labels.

## 7. Relationship to other contracts

- [LTP Proof Package Draft 0.1](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md) supplies proof data.
- [LTP Index Draft 0.1](./LTP-INDEX-DRAFT-v0.1.md) transports it.
- [APW v1.3](./APW-SPEC-v1.3.md) remains the adopted identity/history specification.

These draft profiles do not retroactively change an existing deployment's DNS
policy or declare any runtime conformant. Enabling requires reviewed adapters,
executable vectors with documented authorship and the deployment trust configuration.
