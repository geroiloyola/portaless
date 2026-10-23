# LTP Proof Package — Draft 0.1

**Status:** owner-approved Draft 0.1 contract baseline (2026-10-23); final normative
publication pending the [standardization gates](./LTP-STANDARDIZATION-STATUS.md).
Not adopted as APW v1.3/E-16, implemented, or backed by a completed conformance-vector suite.
**License:** CC BY 4.0.

RFC 2119/RFC 8174 requirement words describe conformance to this draft. A Go,
Rust, WASM or other implementation may implement it without importing any
reference runtime. Existing APW/LTP/SVRI mathematics are referenced below and
are not replaced by an implementation-specific score or certificate.

## 1. Standard terms and profiles

The [LTP Stack](./LTP-STACK-ARCHITECTURE.md) assigns identity/state structure to
APW, evidence/chain/witness evaluation to LTP, the consumable output to SVRI and
the retained/verifiable history of that output to HSVR. This is a trust-proof
package, not a replacement identity method or a second score authority.

| Term | Meaning |
|---|---|
| **LTP Index** | A configured distribution/discovery service for trust and traceability proof data; not an identity or reputation authority. |
| **LTP Proof Package** | The versioned untrusted container defined here, carrying APW identity/state proofs and LTP trust evidence. Proofs inside it, not its availability or an Index signature, determine acceptance. |
| **LTP Attestation** | An original APW issuer-signed `apw-attestation+jws` consumed under LTP rules (APW v1.3 §5.3/§6 plus applicable errata). It is not a new signature format. |
| **SVRI Projection** | The existing versioned projection in SVRI v1.0/E-16. It reports calculation/provenance, not a standalone proof of its inputs. |

Draft 0.1 supports `apw-identity-proof-v1`, `ltp-site-log-proof-v1` and
`ltp-reader-conduct-proof-v1`.
The site-log profile recomputes an SVRI site projection for the explicitly identified,
log-backed snapshot, not every possible fact about a site. Other profiles MUST
return `unsupported_profile`; do not guess their meaning.

`ltp-svri-reader-v1` in APW v1.3 §6.2.1 is a reader's capability to consume/render
SVRI. It MUST NOT be interpreted as a numerical reputation profile for that
reader. The reader-conduct proof profile transports evidence for LTP's R-domain
rules; it does not assign new semantics to SVRI's reader-capability profile.

## 2. Encoding and digests

The [S1 serialization candidate and schemas](./LTP-SERIALIZATION-DRAFT-v0.1.md)
pin exact preimages, null/absence, nested types and numeric representation. The
[static S3 corpus](./vectors/ltp/v0.1/README.md) precedes engine implementation;
owner approval and complete coverage remain required before closing S3.

The container is UTF-8 I-JSON. Reject duplicate object members, invalid Unicode,
nonfinite numbers, fractional integer fields, and integers outside 0..2^53−1.
Object schemas owned by Draft 0.1 are closed: reject unknown structures/fields
rather than dropping them before hashing or inferring a later version. Embedded
APW artifacts/DID documents follow their adopted schema/extension rules; no URL
extension becomes permission to perform network I/O.

- Version strings and enum values match exactly; no implicit downgrade.
- Digests are `base64url(SHA-256(bytes))`, unpadded: 43 characters.
- Object digests use UTF-8 RFC 8785 JCS bytes. Original compact JWS digests use
  the exact received ASCII compact JWS, never JSON reserialization.
- JWS algorithm/type/key-ID, source and claims follow APW v1.3 plus errata.
  Source attestations in this draft use Ed25519/EdDSA; there is no algorithm
  negotiation from an untrusted package. Do not use an Index key in place of a
  subject/issuer key or weaken canonical-byte checks on APW site artifacts.
- Integer timestamps here are Unix seconds. Existing APW key-window and chain
  timestamps retain their specified RFC 3339/ISO representation and semantics.

The container need not be signed by the subject or Index: it transports original
signed artifacts. TLS/service authentication may authenticate the Index endpoint,
but cannot turn its fields into trusted identity, time or calculation statements.

## 3. Container schema

All top-level fields below are required. Null/empty values are explicit as shown.

| Field | Type / rule |
|---|---|
| `typ` | Exactly `ltp-proof-package`. |
| `version` | Exactly `0.1`. |
| `profile` | One of the profiles in §1. |
| `subject` | Canonical `did:apw:<domain>`, matching the consumer's requested subject. |
| `bootstrapProfile` | `independent-doh-ad-v1` or `dnssec-offline-v1`, matching local/request policy. |
| `identities` | Nonempty array of IdentityProof (§4), unique by DID. |
| `histories` | Array of HistoryProof (§5), unique by ID and DID. |
| `attestations` | Array of original compact LTP Attestation JWS strings. |
| `issuerBindings` | Array of IssuerBinding (§6), unique by `(iss,src,kid)`. |
| `calculation` | Null for identity-only and reader-conduct; Calculation (§7) for the site-log profile. |
| `assembledAt` | Integer; Index/assembler-declared time only. Never a proof of observation/freshness. |
| `expiresAt` | Integer; assembler's maximum requested acceptance time, greater than `assembledAt`. Can shorten but never extend verified validity. |

Envelope example (shape only; placeholders are not executable proofs):

```json
{
  "typ": "ltp-proof-package",
  "version": "0.1",
  "profile": "apw-identity-proof-v1",
  "subject": "did:apw:example.com",
  "bootstrapProfile": "independent-doh-ad-v1",
  "identities": [
    {
      "did": "did:apw:example.com",
      "didDocument": {},
      "manifestJws": "<original apw-manifest+jws>",
      "dnsMessages": [],
      "historyRef": null
    }
  ],
  "histories": [],
  "attestations": [],
  "issuerBindings": [],
  "calculation": null,
  "assembledAt": 1790000000,
  "expiresAt": 1790000060
}
```

The package itself does not grant public distribution, reveal private proofs,
choose trust anchors or authorize a request. No field named `verified`, `score`
outside its SVRI Projection, or Index-supplied public key can bypass validation.
The subject IdentityProof MUST be present. All references must resolve uniquely
inside this package or the consumer's explicit local trust/checkpoint state.
Reject unused identity/history/binding objects and duplicate identifiers rather
than processing unrelated proof graphs. Identity-only packages have no
attestations/issuerBindings and make no claim to verified reputation.

## 4. IdentityProof and independent roots

IdentityProof contains exactly:

- `did`: canonical `did:apw:<domain>`;
- `didDocument`: the APW DID document per APW v1.3, with public keys only;
- `manifestJws`: original compact `apw-manifest+jws` per APW v1.3 §5.2;
- `dnsMessages`: array of base64url DNS wire messages, nonempty for offline
  bootstrap and empty for independent DoH bootstrap;
- `historyRef`: null or the ID of that DID's HistoryProof.

For **each** DID used as a key-binding root, apply
[APW Identity Bootstrap Draft 0.1](./APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md).
In the independent-DoH profile the consumer obtains its own root from its fixed
provider; in the offline profile it validates DNSSEC locally. A supplied DID
document, `AD: true`, assembler timestamp or Index receipt cannot establish a root.

Then enforce APW v1.3 §5.1/§5.2: document ID/key thumbprint, `k`, artifact DID/key
ID, signature, canonical bytes and manifest/TXT identity fields must agree.
The manifest's signed `h` may extend the DNS `h` only by valid chain continuity;
do not treat the extended portion as DNS-anchored. A null `h` may describe an
identity without usable reputation evidence; do not invent a nonempty history.

This verifies a DNS-bound key and subject-signed artifact on supplied data. It
does not prove that the consumer independently contacted the subject's HTTPS
server. DID services, aliases and URLs outside the profile's binding checks do
not become trusted fetch destinations merely because they occur in a document.

## 5. HistoryProof, completeness and checkpoints

HistoryProof contains exactly:

| Field | Rule |
|---|---|
| `id` | Digest of JCS of this HistoryProof with the `id` member omitted. |
| `did` | DID of the chain; IdentityProof must reference it. |
| `format` | `full`, `continuation` or `bootstrap-segment`. |
| `checkpointRef` | Consumer-known checkpoint digest for `continuation`; otherwise null. |
| `startSeq` | 1 for `full`; checkpoint seq + 1 for `continuation`; the consumer's expected next sequence for a bootstrap segment. |
| `keys` | APW public log-key list: `keyId` (string or null for legacy), `fingerprint`, `publicKeyJwk`, `validFrom`, `validTo`. No private key members. |
| `keySetJws` | Subject-signed APW key-set binding defined below. The Index cannot authenticate historical key windows by copying unsigned metadata. |
| `entries` | Ordered array of `{seq,jws}` with consecutive sequences, exact original entry JWS bytes. |
| `terminal` | `{seq,hash}` for the intended signed-manifest head; successful completion requires the final verified entry to match it. Empty full chains use seq 0/hash null. |

A full proof begins with seq 1/prev null. Verify each signature, key ID/fingerprint,
subject binding, `prev`, timestamp and key window under APW v1.3 §5.4. Reject
duplicate keys/aliases, gaps, repeated entries, invalid windows and ambiguous
lookups. The active key must match authenticated TXT `k`. The terminal hash must
match the subject-signed manifest head. A declared terminal or an array limit is
not evidence of completeness: if the signed/required head has not been reached,
return `incomplete` or `limit_exceeded`, never verify a truncated prefix.
An empty full chain has `startSeq: 1`, no entries and terminal seq 0/hash null.

### Authenticated historical-key metadata

For indirect transport, the public key list and its validity windows must be
authenticated too: a hash-linked log alone does not bind a separately supplied
unsigned `keys` array. Draft 0.1 therefore defines **APW key-set binding** with
protected JWS header `{alg:"EdDSA",kid:"<current subject key ID>",typ:"apw-key-set+jws"}`
and exact JCS payload fields:

`{version:"0.1",did,keysDigest,terminal:{seq,hash},iat,exp}`.

`keysDigest` is SHA-256/JCS of `keys` sorted by fingerprint then keyId (null before
strings). `did` and `terminal` match this history and the authenticated signed
manifest head. Require `exp > iat`, valid times under the consumer's explicit
freshness/clock policy, and a signature by the subject's **current independently
DNS-bound key**. Do not verify it with a key nominated only by the Index's list.
An expired/revoked current binding cannot refresh acceptance from a cached list.

This binds a subject's key/window declaration, not absolute truth of dates and
not proof against compromise of that subject key. It prevents the Index from
silently extending a retired key's `validTo`. It is a **new draft artifact**,
not an existing APW v1.3 wire format or an assertion that publishers emit it.
Publishers must implement it or the history package is incomplete; falling back
to the existing unsigned list cannot satisfy this package profile.

A continuation starts at the trusted checkpoint seq + 1 with `prev` equal to its
verified entry hash. `checkpointRef` identifies local validated state, **not**
an imported checkpoint from the package. The local checkpoint records DID,
seq/hash/previous timestamp, validated public key windows and key-set digest,
authenticated anchor/provenance, trust-policy digest and verifier rules version.
Revalidate current DNS/key binding and each new entry; incompatible key/window,
policy or anchor changes require revalidation, not splicing. Unknown checkpoints
yield `checkpoint_required`; no hidden request to the subject to retrieve one.

The identity profile may extend from that minimal checkpoint. The site-log
profile additionally requires previously verified prefix source data sufficient
to reconstruct the exact calculation snapshot. A bare seq/hash checkpoint is
not evidence completeness and MUST yield `incomplete` for that calculation.
Partial bootstrap progress that has not reached a required authenticated anchor
must be stored separately and cannot serve as a trusted checkpoint or grant.

### Segmented cold bootstrap

`bootstrap-segment` carries a consecutive slice of the intended chain. The first
slice starts at 1/prev null. Later slices are accepted only against existing
local quarantined progress for exactly the same DID, signed target manifest,
authenticated TXT binding, key-set digest, bootstrap/trust/rules policy and
expected seq/previous hash/timestamp. The service's proposed cursor is never
itself proof that the prefix was checked.

The consumer derives this Resume descriptor from its own processed slice:
`{did,targetManifestDigest,rootManifestDigest,keySetDigest,nextSeq,previousHash}`.
`targetManifestDigest` hashes JCS of the authenticated signed-manifest payload
with `iat` omitted (the stable target identity, not a signature-byte digest);
`rootManifestDigest` hashes JCS of the independently authenticated APW TXT manifest;
`keySetDigest` hashes JCS of the public keys sorted by fingerprint then keyId
(null before strings); `nextSeq` is last processed seq + 1 and `previousHash` is
the last original entry JWS digest. Only public identifiers/digests leave the
consumer. It also keeps locally the prior timestamp, accumulated verification
and source-reconstruction state, dependency expiries and applied policy version.

An initial segment is legal only with no matching local progress; subsequent
segments MUST match the descriptor derived locally, not one imported from the
Index response. Duplicate slices may be recognized without advancing progress;
overlaps/conflicting entries or a changed target/key-set/root require explicit
restart/revalidation. No mixing two targets or silently moving the terminal.
Reissuing a valid signed manifest/key-set binding for the same root, stable
target, terminal and key-set digest may refresh those dependencies without
forgetting prefix work; changing `iat` alone cannot reset progress/quotas or
change which chain was processed. Re-evaluate time-dependent source inputs at
the final authenticated evaluation time; an insufficient retained source prefix
cannot be promoted to a reproduced calculation.

Every segment consumes the normal request/instance quotas and step deadline.
State capacity, retention and accumulated working-state bounds apply; abort or
exhaustion returns a distinct pending/limit result, not a signature failure.
Resume is not a background-work grant and cannot bypass acquisition quotas.
Trust dependencies must still be valid or independently revalidated at final
promotion; replacing them with incompatible data invalidates the staged result.

At the terminal, recheck the independently authenticated root, key/window and
signed-target bindings and the required DNS anchor/coverage. Only then may the
quarantined prefix become a trusted identity/history checkpoint. For a site-log
calculation, every required source must also be verified and reconstructed;
retaining only hash/seq cannot satisfy evidence completeness. A bounded source
accumulator may process sources in order, but must not drop negatives or change
selection semantics to fit. If working-state limits prevent complete calculation,
report partial/limit and do not promote its SVRI Projection.

This permits a finite legitimate chain larger than one step to complete through
multiple bounded steps; it does not promise arbitrary corpus size, permanent
progress retention or a global quota across instances. Executable vectors must
prove multi-step completion, restart, conflicting targets and no partial grants.

Known rollback to a lower seq, contradictory hash at a known seq or inconsistent
anchor MUST fail explicitly. A first-time consumer without an independent newer
observation cannot prove the absence of a newer, still-unseen state.

## 6. LTP Attestations and issuer binding

Each original JWS is parsed/verified per APW v1.3 §5.3 and relevant source rules,
including `iss`, `sub`, `src`, category, value scale, `iat`, key window and `jti`.
Historical attestations use historical key-window semantics, not a fresh-request
age check. Source tiers do not prove truth and do not multiply weights.

IssuerBinding contains exactly `iss`, `src`, `kid`, `kind`, `ref`:

- `kind: apw-identity`: `ref` is an IdentityProof DID. Its independently verified
  key/history must bind this issuer/key at the signed instant.
- `kind: local-trust-key`: `ref` names an existing consumer/operator trust record
  binding expected issuer, source, public key, key ID/window and allowed scope.
  The package cannot create that record or assign itself an escrow/agent role.
  This supports the explicit registered-provider/agent trust assumptions in APW,
  not an Index-supplied replacement for independent identity.

Unsupported/missing issuer bindings produce `issuer_unverified`, not admission.
A signature from the subject cannot replace an independent issuer's signature.
Self-declarations remain self-declarations; user/issuer identities and site W
versus reader R domains cannot be interchanged.

For the site-log profile, every `att` reference in the requested log snapshot
must have an original matching JWS; every supplied attestation must belong to
that snapshot. Deduplicate exact retransmission by digest; reject distinct
payloads with the same `(iss,jti)` rather than choosing one by arrival order.
Any authorized legacy exception must be part of the identified rules policy;
it produces incomplete coverage, not a fully verified reconstruction.

This completeness is **relative to the committed log snapshot**, not proof that
the subject recorded every evaluation that exists in the world. Sources outside
that log are not silently added to or claimed covered by this draft profile.

For `ltp-reader-conduct-proof-v1`, apply the same subject-chain/bundle hash and
completeness checks before selection. Select `reader_conduct` claims whose `sub`
is the requested reader DID and whose issuer is distinct, then verify each
required original issuer JWS/window under APW §6.4. Map categories/boolean values
and deduplication using LTP's existing R-domain rules, not site W scores. Other
chain records still require correct hash inclusion; they do not become R evidence
or justify arbitrary additional issuer fetches. If candidate/issuer caps prevent
verification of required selected evidence, return partial/limit, not a score
from a convenient truncated subset. `calculation` remains null: a consumer may
calculate LTP R dimensions locally but cannot invent a new scored SVRI profile.

## 7. Calculation and SVRI Projection

Calculation contains exactly:

- `profile`: `ltp-svri-site-v1`;
- `rulesVersion`: `ltp-svri-site-v1` for this draft;
- `coverage`: exactly `subject-log-snapshot`;
- `snapshot`: `{did,seq,head}` identifying the fully reconstructed snapshot;
- `evaluatedAt`: integer matching the authenticated subject manifest's `iat`;
  apply all time-dependent rules at this instant, and require it to satisfy
  the consumer's explicit signed-snapshot freshness/clock policy;
- `evidenceSetDigest`: digest of JCS of all original snapshot attestation JWS
  digests, sorted lexicographically as ASCII strings, with exact duplicates removed;
- `projection`: the full SVRI Projection v1.0 (§3 of that specification).

The consumer verifies the digest from proofs, reconstructs current source rows
from the ordered committed log, and recomputes under APW/LTP Annex A, E-13 and
SVRI v1.0. `self` and `agent` use the latest entry per category in this log
snapshot; retain distinct community/escrow JWSs by `(iss,jti)`, applying the
normative community source-selection rules when calculating effective evidence.
Counts deduplicate `(iss,jti)`. Any profile-specific
source not representable with these rules is unsupported, not guessed.
The deterministic candidate/source set and all local issuer-trust policy inputs
must be reported to an authorized verifier so another engine can reproduce the
same result. An Index is not an emitter merely because it transports a record.
An emitter's age/calibration/provenance input must itself be derivable from
admissible proof or explicit local trust policy; an Index-supplied first-seen
timestamp is not proof. If a required input cannot be established, do not assign
its weight as if it were known: report partial/no-data under the source rules.

Use the normative LTP prior `P=3`, dimension rules and weights, then the SVRI site
mapping from 1–7 to 0–10, provenance counts, `priorShare`, `isInference`,
`incompleteData` and public-level ordering in SVRI v1.0. No evidence-backed
dimension means no observed score: preserve the prior's inference label and
public `pending`. Do not include reader_conduct in site W scoring merely because
it appears in the log; activity/provenance follows SVRI's separate rule.

Integer/boolean/version/count/digest fields must match exactly. Compare finite
numeric results with absolute tolerance at most 1e-9 for this draft; determine
the qualitative level from the recomputed unrounded value, not the supplied
number or tolerance band. Units/scales must match; a numeric reader score is not
a site score. Unknown profile/rules or mismatches yield `projection_mismatch` or
`unsupported_profile`, never a trusted fallback to the announced level.

A complete site-log verification requires that the calculation head is
DNS-anchored, with all required source proofs accepted and the specified input
coverage reproduced. Newer subject-signed but DNS-unanchored entries remain
explicitly partial for this profile. This is a profile's scope restriction,
not a retroactive change to APW's ability to represent unanchored entries.

## 8. Acceptance result, validity and privacy

A consumer-produced result separates:

- `identity`: verified / unverified / unavailable;
- `history`: verified / partial / invalid / unavailable;
- `evidence`: complete-for-snapshot / partial / no-data / invalid;
- `projection`: recomputed-log-snapshot / declared-only / pending / mismatch;
- `bootstrapProfile`, observation/freshness limitations, verified seq/head,
  rules/trust-policy digest and acceptance expiry.

`declared-only` is an attributed signed claim when independently bound to its
issuer; it is not `recomputed-log-snapshot` and MUST NOT satisfy a policy requiring
reproduction. An Index-supplied claim without valid issuer binding is unverified.
No package status grants resource access, enables a category or activates R-05.

Effective expiry is no later than the minimum of local acceptance policy, the
assembler's requested expiry, independent-root acceptance, key windows and all
proof dependencies. An assembler timestamp or nonce cannot refresh an old DNS
observation. Apply the bootstrap profile's revocation/replay limitations; do not
promise instantaneous revocation or globally latest state. Never extend cache
lifetimes on hits or convert a deadline/cap into `signature_invalid`.

Re-verification must fit consumer limits for decoded bytes, identities, DNS
records/signatures, log pages/entries/keys, attestations, issuers, total crypto
operations and deadline. Stop before expensive work when a bound is reached;
release active permits on all paths. Resource limits are explicit operator
policy, not a permission for truncation or silently weaker verification.

Public responses/renderers obey SVRI v1.0 public-level rules. Full calculations,
counts, governed proofs and HSVR require appropriate authorization. The Index
must acquire/distribute only data approved for that audience and must not turn
private proof material into public cache entries. Possession of an Index
signature or a package field is not an authorization grant. A proof-carrying
public level that hides otherwise-required evidence is not implemented by this
format; do not claim zero-knowledge verification without such a separate profile.

## 9. Required independent conformance vectors

Baseline approval is recorded in [contract approval and standardization gates](./LTP-STANDARDIZATION-STATUS.md);
it does not waive these adoption/activation requirements.

Before adoption/activation, publish machine-readable inputs, local trust policy,
fixed clocks/checkpoints, canonical bytes/digests and expected outputs independent
of any runtime implementation. At least two independent verifiers must agree on:

1. identity success under both bootstrap profiles with distinct provenance;
2. self-signed fake root, forwarded AD, mismatched DID/key/subject and algorithm;
3. chain mutation/gap/rollback, unknown checkpoint and unanchored/incomplete prefix,
   changed unsigned key windows, bad/expired key-set binding and falsely trusted
   bootstrap segments, including multi-step completion beyond one step's cap;
4. source signature/hash mismatch, duplicate `(iss,jti)`, substituted issuer role,
   hidden source, missing historical key and incomplete versus absent data;
5. exact digest/JCS bytes, prior-only pending, source counts, scale, inference and
   all existing SVRI boundaries, plus floating-point boundary disagreements;
6. expired/future proof, valid-but-replayed offline DNS, stale declared level,
   cache/clock limits, huge input, budget/deadline exhaustion and no misconduct;
7. zero arbitrary-subject network calls and no import of runtime-specific APIs
   in the protocol verifier; private/public audience enforcement separately.

Until these vectors and implementations exist, this document is an **owner-approved
draft contract baseline**, not a final interoperability standard, a demonstrated
conformant implementation or a new SVRI certificate.

## References

- [APW v1.3](./APW-SPEC-v1.3.md), with [published errata](./ERRATA.md).
- [SVRI v1.0](./SVRI-v1.0.md) and its vectors (verificación cruzada, mismo autor; no external review claimed).
- [APW Identity Bootstrap Draft 0.1](./APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md).
- [LTP Index Draft 0.1](./LTP-INDEX-DRAFT-v0.1.md).
