# LTP serialization and schema contract — S1 candidate 0.1

**Status:** exact definitions proposed for owner approval before S3 is frozen.
**License:** CC BY 4.0. These definitions complete the approved architecture;
they are not a v1.0 release or an implemented verifier. No networking or budget
implementation is supplied here.

## 1. Schema set and scope

All schemas use JSON Schema 2020-12. Resolve these URNs from the local schema
bundle, never by fetching an untrusted `$ref`. No defaults, coercion, property
removal, implicit downgrade or error recovery is permitted.
The [schema manifest](./schemas/v0.1/manifest.json) pins each exact SHA-256/JCS
commitment for owner approval; it is test/publication metadata, not a new wire message.
Its bundle commitment is `2-OWDPkYHe3A_DYyUbSsE5t1jFRyNxNM6DnVml-Tp7w`.

| Schema | Contract |
|---|---|
| [common.schema.json](./schemas/v0.1/common.schema.json) | Integers, canonical DIDs/digests, public Ed25519 JWKs, heads, TXT-manifest input and resume descriptors. |
| [ltp-proof-package.schema.json](./schemas/v0.1/ltp-proof-package.schema.json) | Package, IdentityProof, HistoryProof, key windows, IssuerBinding, Calculation and decoded key-set payload. |
| [svri-projection.schema.json](./schemas/v0.1/svri-projection.schema.json) | The full administrative SVRI v1.0 projection inside Calculation. |
| [ltp-resolution-request.schema.json](./schemas/v0.1/ltp-resolution-request.schema.json) | Typed supported request. |
| [ltp-resolution-result.schema.json](./schemas/v0.1/ltp-resolution-result.schema.json) | Result, explicit nulls and status/reason constraints. |

Schema success is structural only. A SHA-256 digest may have the right shape
but the wrong bytes. Cross-references, identity, DNSSEC, signatures, expiry,
completeness, duplicates by DID/issuer, source selection and recalculation remain
mandatory semantic checks. Embedded adopted DID documents retain their extension
rules; extensions remain in the hashed object, cannot authorize fetches and must
not contain private key material. The schemas do not change APW v1.3 wire formats.

## 2. Input bytes and null versus absence

1. Decode UTF-8 strictly, without BOM. Reject invalid UTF-8, lone surrogates,
   duplicate object members (including escape-equivalent names), non-I-JSON
   values and integers outside the safe range. Reject before constructing a map
   that would silently overwrite duplicate members. `1` and `1.0` represent the
   same JSON number, not different signed numeric types.
2. All fields listed as required MUST be present. A nullable field is the JSON
   token `null`, never `"null"`, `undefined`, an empty string or an omitted member.
   In particular result `package`, `packageDigest`, `reason` and
   `retryAfterSeconds`, IdentityProof `historyRef`, HistoryProof `checkpointRef`,
   key `validTo` and package `calculation` must be explicit when null.
3. APW TXT optional `h` and `rg` follow their adopted rule: **omit when absent**;
   do not insert null or false. This is a different schema from a nullable package
   member. `h` absent means no DNS anchor, never a zero digest.
4. New envelope objects permit transport whitespace/member ordering. Their hash
   input is JCS, not the raw HTTP body. Signed APW site headers/payloads MUST be
   received in JCS form. Existing foreign issuer JWS payloads are verified as
   received, not normalized into a new signature input.
5. Counts and times are numbers, never numeric strings. Timestamps in package
   integer fields are Unix seconds; existing APW key/log timestamps retain their
   explicit UTC RFC 3339 representation and must be valid calendar instants.
   Fractional digits in those strings are preserved for hashing, not rewritten.

## 3. Canonical serialization and hash ledger

Let `C(x) = UTF8(RFC8785-JCS(x))`, `H(b) = base64url(SHA256(b))` and
`U(s) = ASCII(s)`. Base64url is unpadded and canonical: decoding and re-encoding
MUST reproduce the original string. No newline/BOM/terminator is hashed.
JCS sorts object names by UTF-16 code units, preserves array order and Unicode
code points without NFC/NFD normalization, and serializes finite binary64
numbers under RFC 8785/ECMAScript, including `-0` as `0`. Numeric comparison
tolerance is never permission to round or normalize bytes before hashing.

| Commitment | Exact preimage |
|---|---|
| RFC 7638 `k` / fingerprint | `C({crv:"Ed25519",kty:"OKP",x})`; only those three public members. |
| `packageDigest` | `C(package)`, preserving every array's supplied order. Null package requires null digest. |
| HistoryProof `id` | `C(historyWithoutId)`; remove exactly the top-level `id`, not nested identifiers. |
| `keysDigest` / `keySetDigest` | `C(sortedKeys)`; sort the **complete five-field key records** by fingerprint, then keyId, using UTF-16 lexicographic comparison; null keyId precedes strings. The package need not transmit keys in that order. Reject duplicate/ambiguous keys before using the list. |
| Chain `att`, `prev`, `h`, JWS digest | `U(originalCompactJws)`, including the exact original protected-header and payload segments. Never parse/reserialize a JWS to compute this hash. |
| `evidenceSetDigest` | `C(sortedDistinctJwsDigests)`; distinct exact JWS digests, ASCII lexicographic order. This is not an array of parsed payloads. Duplicate `(iss,jti)` with different payloads still fails independently. |
| `targetManifestDigest` | `C(decodedSignedManifestWithoutIat)`; omit exactly its top-level `iat`, keep all other signed members and array order. Only use after authenticating the original manifest. |
| `rootManifestDigest` | `C(authenticatedTxtManifest)` validated against `common#/$defs/txtManifest`: exactly `v,siteId,trustUrl,contentKinds,k` and `h,rg` **only if present in the independently authenticated TXT JSON**. No DID, `iat`, TTL, receipt time, parser metadata or Index fields. No synthesis from the signed HTTPS manifest. |
| Local `checkpointRef` / checkpoint ID | `C(checkpointCore)` defined below. Retention metadata does not authenticate, extend or create this core. |

For `rootManifestDigest`, concatenate TXT character-strings within one RR before
strict JSON parsing; do not concatenate separate RRs. This package profile
requires the closed v2 TXT object defined above. Unsupported extensions fail
explicitly instead of being silently dropped from the commitment. The DNS owner
name, resolver/anchor, TTL and observation channel remain bound in local trusted
context; the root digest is not itself an identity proof.

An Ed25519 compact JWS is exactly
`base64url(headerBytes) + "." + base64url(payloadBytes) + "." + base64url(signature)`.
Sign the ASCII bytes of the first two segments joined by one dot. Ed25519 signs
that message directly (not Ed25519ph and not a separately computed SHA-256
digest). A signature is 64 bytes. For new key-set bindings the protected header
has exactly `alg: "EdDSA"`, current subject `kid`, `typ: "apw-key-set+jws"`;
payload fields are exactly the `keySetPayload` definition. Require `exp > iat`.

The local checkpoint core has exactly `did`, `seq`, `hash`,
`previousTimestamp`, `keys`, `keySetDigest`, `rootManifestDigest`,
`bootstrapProfile`, `trustPolicyDigest`, `rulesVersion`, `sourceStateDigest`.
`keys` uses the sorted full records defined above. `sourceStateDigest` is null
for identity-only progress, or `H(C({entries,attestations}))` of the verified
prefix's original ordered log entries and distinct original JWSs sorted by their
digest. It binds retained source data, not a convenient scalar score. The local
wrapper stores this core, its ID, retention/validity bounds and any bound prefix
source material. An Index may reference an existing ID but cannot install this
state. Quarantined bootstrap progress remains a separate untrusted class.

With local wall-clock instant `now`, a key-set binding requires `iat <= now +
clockSkewSeconds` and `now < exp`; skew does not extend expiry. The manifest must
meet the explicit local snapshot-age policy. Local retention/acceptance ends at
`now >= retainedUntil` / `validUntil`. APW signing-key window endpoints retain
their adopted inclusive semantics. Corpus clocks and skew policies are explicit.
DNSSEC RRSIG inception/expiration are inclusive under RFC 4035 §5.3.1 (using
DNS serial-number time arithmetic where required); do not confuse that
cryptographic interval with an exclusive local cache deadline. The expired-RRSIG
target uses an instant strictly after expiration.

## 4. Semantic bindings and failure precedence

Validation runs in this order so an earlier structural/crypto error is not
misreported as a later score failure:

1. Bounded strict JSON, envelope/schema/version, request/result binding and
   packageDigest. References are data; no URL is followed.
2. Independent identity bootstrap, DID/key/TXT binding and manifest header,
   canonical payload, signature and freshness. Authenticate every needed root.
3. History ID/reference uniqueness, current-key key-set signature/expiry and
   key/window binding; full-chain or trusted-continuation/progress rules.
   A checkpoint past its local retention or dependency validity is not trusted
   merely because its hash matches: revalidate or return `checkpoint_required`.
4. Ordered chain signatures, seq/prev/timestamps/key windows and target/anchor.
   Verify original source JWSs, issuer scope and hash inclusion/completeness.
   A missing negative source cannot be discarded to make the score calculable.
5. Evidence-set digest, snapshot DID/seq/head, authenticated evaluation time,
   source selection, SVRI arithmetic, flags and qualitative level.
6. Effective dependency expiry and separate resource authorization. Positive
   cryptographic verification never creates a grant.

`snapshot.seq = 0` iff `snapshot.head = null`; otherwise head is a digest.
Subject, profile and bootstrapProfile match the request/result/package exactly.
All identity/history references resolve uniquely, all included proof objects are
used, and all `kind: apw-identity` issuer/key/time bindings must be independently
verified. All private/administrative details remain audience-authorized.

## 5. SVRI numeric representation and mathematical oracle

### Signed numeric profile and current corpus finding

All numeric values in the candidate corpus's **signed JWS payloads are safe
integers**, with no decimal/exponent tokens. Python scans every fixture (including
literal patches) with float-token rejection; Node recursively checks decoded
original payload values. No existing signed byte is rewritten. For new signed
payloads in this Draft, nonintegral/unsafe numbers are forbidden: represent
fractions as explicitly specified numerator/denominator decimal **strings**, or
use a documented integer scale/string field under a versioned schema. Do not
invent representations for adopted foreign JWSs; unsupported numeric semantics
fail explicitly. JCS treats `1.0` as `1` before signing, not as a distinct type.

The 12 [numeric serialization vectors](./vectors/ltp/v0.1/numeric-serialization.json)
compare Python and Node for safe endpoints, -0, integral decimal/exponent inputs,
fractional binary64 values, large decimal strings and rational strings. The
extension digest is `RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g`;
it is pinned separately and does not replace the original corpus commitment.
The Python serializer is fixture-scoped, not a general RFC 8785 implementation;
agreement on this finite set is not proof of universal numeric equivalence.

SVRI's finite decimal outputs below are **unsigned projection fields**, although
their exact JCS bytes are committed by `packageDigest`; that digest is not a JWS
signature over the package. They retain the adopted representation and formulas.
**Any future signed SVRI/HSVR MUST use rational or string encoding, never
floating-point JSON numbers** for score/weight/fractional values. A rational uses
explicit decimal-string numerator/denominator fields; a scalar string requires
its own specified canonical grammar. Such a future profile needs a versioned
schema and new vectors before use. Counts/times remain safe integers. No signed
SVRI/HSVR profile is introduced here; adopted unsigned projection fields and
their formulas stay unchanged.

The schema specifies **all 14 administrative fields**, including rulesVersion.
`publicLevel` is derived separately, not inserted as a fifteenth package field.
Public output remains limited by SVRI v1.0; a full administrative object is not
made public by satisfying this schema.

For each included evidence-backed dimension `d`, use the adopted equations:

```text
P = 3
S_d = (12 + sum(w_i * v_i)) / (3 + sum(w_i))
score = mean(10 * (S_d - 1) / 6)
effectiveWeight = sum_d(sum_i(w_i))
priorShare = 3 * dimensionCount / (3 * dimensionCount + effectiveWeight)
isInference = priorShare > 1/2
incompleteData = (t1Count + t2Count == 0)
```

Zero effective dimensions mean score 5, priorShare 1, weight/count 0, inference
true. T4 activity does not create a W dimension. Counts are distinct verified
`(iss,jti)`, never duplicated per derived dimension. Tier is not a weight bonus.
Follow the adopted source/value/selection rules before these equations.

Transmit finite JSON numbers, without display rounding. The corpus carries exact
rational numerators/denominators as **test-oracle metadata**, not new protocol
fields. An implementation compares recomputed numerical fields within absolute
`1e-9`, but counts/booleans/digests/versions exactly. Determine pending/low/verify/
safe/trusted from recomputed **unrounded** values, with SVRI v1.0 ordering; tolerance
must not change a boundary decision or excuse wrong inference/completeness flags.
Two binary64 values inside tolerance can still have different JCS bytes/digests.

The signed-chain baseline includes one completed and one disputed escrow claim,
each with explicitly configured issuer `J=4`, hence weight `1/4`:

```text
S_W05 = (12 + (1/4)*7 + (1/4)*1) / (3 + 1/4 + 1/4) = 4
score = 5; effectiveWeight = 1/2; priorShare = 6/7
t1Count = 2; incompleteData = false; isInference = true; publicLevel = verify
```

## 6. Result nulls, reasons and HTTP mapping

All typed results have all eleven required fields. Candidate/incomplete echo a
supported profile; an unsupported result may echo the original nonempty unknown
profile string, without creating a supported profile. Malformed inputs that
cannot bind a canonical subject/requestId return HTTP 400 without pretending to
be a typed resolution result. A 429 quota result uses `limit_exceeded` plus
`budget_exhausted`, not an eighth status value.

| Status | Reasons | Package | HTTP | Retry field/header |
|---|---|---|---|---|
| candidate | null | Nonnull, matching digest | 200 | Body null; header absent. |
| incomplete | proof_incomplete / checkpoint_required / history_step_limit | Null or partial candidate plus matching digest | 200 | Positive integer only when meaningful retry/progress is available; otherwise null. |
| no_data | proof_not_available | Null, digest null | 200 | Null/absent. |
| unsupported | invalid_request / unsupported_version / unsupported_profile | Null, digest null | 400 | Null/absent. |
| denied | authentication_required / access_denied | Null, digest null | 401 / 403 respectively | Null/absent. |
| unavailable | service_unavailable | Null, digest null | 503 | Positive integer when retryable, otherwise null. |
| limit_exceeded | budget_exhausted | Null, digest null | 429 for client quota; 503 for non-client capacity | Positive integer when retryable, otherwise null. |
| limit_exceeded | request_too_large / response_limit_exceeded / deadline_exceeded | Null, digest null | 413 / 503 / 503 respectively | Positive integer only for a transient condition, otherwise null. |

If retryAfterSeconds is N, the HTTP `Retry-After` header is its ASCII decimal
integer spelling with no plus sign or leading zeros. If the body field is null,
the header is **absent**, not the literal string `null`. Neither transport header
is part of a package/JWS hash. A redirect remains the existing separate uncached
401 without Retry-After; service failures do not become misconduct.

## 7. Vector-first execution gate

The [S3 corpus](./vectors/ltp/v0.1/README.md) is authored from these definitions,
with isolated cryptographic tools and static expected bytes/results. Runtime
tests must consume those files, never regenerate expectations using Portaless.
Before owner approval the corpus remains a candidate. After approval, changing
a vector to accommodate code is forbidden: a documented, reviewed vector
error requires an explicit reviewed/versioned correction, not an overwrite.

Implementation permissions are defined solely by
[LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).
Corpus acceptance, hash equality and PR merge never authorize engine programming,
network adapters or production quota logic by themselves. G1 assets are accepted;
G2/G3 received separate bounded owner decisions, while G4/G5 and S4/S6 retain
their separate requirements.
