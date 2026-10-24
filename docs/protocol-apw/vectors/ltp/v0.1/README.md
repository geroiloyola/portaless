# LTP S3 — static cryptographic and mathematical corpus 0.1

**Status:** candidate for owner approval; not a v1.0 release or a production
engine conformance report. **License:** CC BY 4.0, including isolated tools.

This corpus precedes the engine. The specification is
[LTP serialization/S1](../../../LTP-SERIALIZATION-DRAFT-v0.1.md); schema URNs
resolve from [the local bundle](../../../schemas/v0.1/). APW/LTP/SVRI semantics
remain governed by the linked adopted specifications and approved contracts.

## Files, math and exact commitments

[`manifest.json`](./manifest.json) lists 41 static JSON assets and their
SHA-256/JCS commitments. Its own digest is
`fbc9_xl0gKJlfH7JCslUsoOgHoQNrFuVRGdyPKEme0U` (same digest rule).
The expected values are literal data, not computed by an engine under test.

| Assets | Scope |
|---|---|
| [valid-proof-chain.json](./valid-proof-chain.json) | Original Ed25519 issuer attestations, two signed chained entries, signed manifest/key-set, explicit independent-root fixture, local issuer policy, exact full package and SVRI expectation. |
| [crypto-ledger.json](./crypto-ledger.json) | Eight original JWS references with exact protected/payload/signing-input digests and canonicality expectations; deterministic public test seeds. |
| [invalid-signature.json](./invalid-signature.json), [invalid-log-signature.json](./invalid-log-signature.json), [invalid-attestation-signature.json](./invalid-attestation-signature.json) | Actual one-bit signature mutations. Outer package/history digests are explicitly recalculated in static data, so the intended failure is not masked by an unrelated envelope digest error. The mutated issuer JWS first fails the signed `att` binding. |
| [valid-signature-noncanonical-payload.json](./valid-signature-noncanonical-payload.json) | A mathematically valid signature over a noncanonical APW manifest, still rejected by the canonical-byte rule. |
| [expired-key-set.json](./expired-key-set.json), [changed-key-window.json](./changed-key-window.json) | Correctly signed but expired metadata, or unsigned key-window substitution that violates its signed digest. |
| [valid-continuation.json](./valid-continuation.json), [expired-checkpoint.json](./expired-checkpoint.json), [unknown-checkpoint.json](./unknown-checkpoint.json) | Bound local prefix/source state, expiry exactly at retention end, and absent trusted state. An expired checkpoint means `checkpoint_required`, not a bad signature. |
| [valid-bootstrap-step-1.json](./valid-bootstrap-step-1.json), [valid-bootstrap-step-2.json](./valid-bootstrap-step-2.json), [untrusted-bootstrap-prefix.json](./untrusted-bootstrap-prefix.json) | Two entries over two bounded steps (fixture cap 1), the exact Resume descriptor and rejection of an imported/unverified prefix. No partial grants. |
| [dnssec-proofs.json](./dnssec-proofs.json), valid-offline-dnssec-[8](./valid-offline-dnssec-8.json)/[13](./valid-offline-dnssec-13.json)/[15](./valid-offline-dnssec-15.json) | Real DNS wire messages and RRSIGs for root DNSKEY → child DS → child DNSKEY → exact APW TXT. RSA/SHA-256 (2048 bits), ECDSA P-256/SHA-256 and Ed25519; DS SHA-256. |
| [offline-expired-rrsig.json](./offline-expired-rrsig.json), [offline-invalid-txt-signature.json](./offline-invalid-txt-signature.json), [offline-missing-delegation.json](./offline-missing-delegation.json), [offline-replay-not-online.json](./offline-replay-not-online.json) | Expiry, cryptographic mutation, missing chain data and valid offline evidence that cannot prove a fresh online observation. |
| [svri-math.json](./svri-math.json) | 13 exact-rational oracles: prior only, T4 exclusion, positive/negative evidence, half-prior, incomplete T3/T5, thresholds 5/7/9, near-boundary values and multi-dimension mean. |
| [encoding.json](./encoding.json) | Eight exact JCS UTF-8/hex/hash cases plus seven raw malformed-JSON targets (duplicate/escaped duplicate, BOM, invalid UTF-8, lone surrogate, NaN and unsafe integer). |

There are 37 resolution scenarios, 13 arithmetic scenarios and 15 encoding/parser
targets: **65 scenarios** in this candidate corpus. They are targets for a future
engine; their presence is not a claim that such an engine already passes them.

The signed-chain calculation has **verificación cruzada (mismo autor)**:

```text
Issuer R-05 J = 4  => w = ((4 - 1)/6)^2 = 1/4
completed_as_promised => v = 7; disputed => v = 1
S_W05 = (12 + 7/4 + 1/4)/(3 + 1/4 + 1/4) = 4
score = 10*(4 - 1)/6 = 5
priorShare = 3/(3 + 1/2) = 6/7
T1 = 2, incompleteData = false, isInference = true, level = verify
```

The arithmetic-only cases take already-admissible dimension totals as inputs;
they do not fabricate proofs that a community emitter has calibrated weight.
Their rational strings are oracle metadata, not new SVRI wire fields. They
pin the unrounded qualitative boundary independently from binary64 tolerance.

## Fixture wrapper versus protocol messages

A complete resolution fixture contains `id`, `request`, `result`, `local`,
`expected`. Derived fixtures contain `id`, local `base` filename, literal RFC
6902 `patch` operations and `expected`. Resolve the base recursively, deep-copy
it, apply the ordered operations, then replace the wrapper id/expected. No
hashing, signing or baseline generation takes place while materializing a case.
All resulting digest replacements are already literal values in the patch.
References use only files listed in the manifest, with no network or external
path resolution. Ledger `ref.pointer` addresses the raw JSON file, not its
materialized result. Unknown patch operations fail.

`local` is **consumer-owned test context**, not an object accepted from the
Index: fixed trusted clock/policy, provisioned issuer keys, independent online
observation fixture or offline DNSSEC trust anchors, trusted checkpoints and
separate quarantined progress. The online observation is a controlled trusted
channel fixture, not a claim of a real DNS/HTTPS query. DNSSEC roots and private
test seeds are synthetic/public test material, not production anchors or keys.
RSA reuses its fixture key across root/child for a small deterministic example;
this is not a production key-management recommendation.

`proofAccepted` concerns the requested proof profile; `resourceGrant` remains
false in every scenario. A verified identity or recomputed projection never
creates resource authorization. `stage`/`reason` identify local validation, not
an Index's assertion of a cryptographic result or a universal HTTP response.
Service HTTP mapping follows S1 §6; infrastructure failures are not misconduct.

## Reproduce and audit without a production engine

Authoring oracle: Python 3 standard library only. Ed25519 reference arithmetic
is self-checked against RFC 8032 test 1; RSA fixture primes are deterministic
test-only probable primes; ECDSA uses RFC 6979. Projection math uses exact
`fractions.Fraction`. It imports no runtime code, performs no network work and
**prints** assets/patches rather than overwriting golden files.

```bash
python3 docs/protocol-apw/vectors/ltp/v0.1/tools/author.py --check
```

Byte/math **verificación cruzada (mismo autor)**: Node 24, public `canonicalize`
and Ajv, pinned in the specification's own [package](../../../package.json).
Native Node/OpenSSL verifies the same author's Ed25519, RSA and ECDSA signatures. The audit
reconstructs the fixture RRset signing bytes, checks DS/key bindings, validates
schemas and compares exact rational results with a separate BigInt calculation.
It reads static fixtures; it does not invoke the authoring generator.

```bash
node docs/protocol-apw/vectors/ltp/v0.1/tools/audit.mjs
node node_modules/vitest/vitest.mjs run tests/unit/ltp-vector-assets.test.ts
```

The audit checks all 41 frozen asset commitments, schema classifications of the
37 cases, eight signed JWS originals, twelve RRSIGs, signature mutations and
thirteen mathematical oracles. The seven malformed JSON inputs are future
strict-parser rejection targets; this audit does not implement that parser.
The test also proves that altering fixture content in memory fails the frozen
commitment rather than updating expectations.

### Third-party primitive checks and discrepancies

Authoring and orchestration scripts have the same author. OpenSSL CLI, the
standard `jose` library and dnspython/cryptography were written by third parties;
using them is **not independent human review** or a second full LTP verifier.

**Shared primitive backend:** in this Node/Python audit, OpenSSL CLI and native
Node crypto use OpenSSL; `jose` uses Node WebCrypto backed by OpenSSL, and
dnspython uses `cryptography`, also backed by OpenSSL. They share the **OpenSSL
backend family**, not necessarily one version, build or loaded library. The
report records CLI, Node and cryptography backend versions so this is observable.
This cross-check validates **encoding, canonicalization and structure**, and
agreement/rejection through different interfaces; it does **not establish
independence of cryptographic primitives**. Python's test-only reference arithmetic
is not an externally reviewed production backend either. **S4** must bring another
person's verifier in **another language with another primitive backend**, identify
that backend and revision, and compare the full relevant corpus. Changing language
while calling OpenSSL again would not supply primitive independence. S4 is pending.

Install the standalone Node package and Python requirements as described in the
[preparation plan](../../../LTP-EXTRACTION-PLAN.md), then run:

```bash
LTP_PYTHON=/tmp/ltp-audit/bin/python npm run audit:external --prefix docs/protocol-apw
LTP_PYTHON=/tmp/ltp-audit/bin/python npm test --prefix docs/protocol-apw
python3 docs/protocol-apw/vectors/ltp/v0.1/tools/numeric-audit.py
```

Recorded local result (2026-10-23): OpenSSL **3.6.4** checks 20 originals
(8 JWS + 12 RRSIG); `jose` **6.2.3** checks 8 JWS; dnspython **2.7.0** with
cryptography **46.0.3** checks 12 RRSIG plus 48 time boundaries. OpenSSL/JOSE
reject 28 mutated signatures; dnspython rejects 12. No cryptographic discrepancy
was observed. dnspython's own canonical signing preimages also match all 12 ledger
digests. The JSON report fails closed on a disagreement; it never rewrites vectors.
dnspython validates individual RRsets using supplied test keys, **not a complete
DS delegation chain**. `rrsig-preimages.py` uses a pinned private dnspython API;
upgrades must recheck it. The Node harness uses SPKI export and P-256 DER format
conversion only; OpenSSL CLI performs the actual signature verification.

**RRSIGs are real signatures over synthetic data.** Names, anchors, clocks and
keys are fixtures, not observations of signed public DNS zones or production
root anchors. A parser/byte checker in fixture tooling is not a production DNSSEC
validator; offline support requires an approved audited-library adapter.

The [numeric extension](./numeric-serialization.json) adds 12 separately pinned
Python/Node serialization cases, digest
`RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g`. These extend the 65 original
targets to **77**, without rewriting the 41 original assets or their digest.
No signed payload has float tokens; unsigned SVRI projection numbers retain
their adopted semantics. Tests reject signing a fractional numeric value.

The DNSSEC ledger also pins four validity-boundary instants. RFC 4035 §5.3.1
includes both RRSIG endpoints; the expired-proof target is strictly **after**
expiration. This is separate from exclusive local cache/key-set deadlines.

These tools are fixture authoring/auditing resources, **not S4's two full LTP
verifiers**. They do not implement production network acquisition, DNSSEC policy,
budgets, SSRF handling or resource authorization. S2/S5 remain a later phase.

## Approval and coverage boundary

Owner approval must identify all three data digests **and the normative prose
commit** in the [approval record](../../../LTP-APPROVAL-RECORD.md), with explicit
scope and an owner decision. Data digests alone do not cover the text. Preserve originals and record any future
correction as a reviewed/versioned change supported by documented cross-checks; do not
adjust vectors until an implementation happens to pass.

**BLOCKING — corpus approval is not available until the selected scope has complete coverage.**
The [S3-core / S3-reputation matrix](../../../LTP-S3-COVERAGE.md) separates the
proposed A/B gate from deferred reputation/offline-profile work. S3-core still
lacks bootstrap/TXT/DoH negatives, did.json substitution/uniqueness cases,
history rotations/multiple-key ordering, every service error class and complete
resource-bound targets. S3-reputation remains Draft: reader-conduct issuer chains,
conflicting `(iss,jti)`, community calibration/age and advanced DNSSEC. No live
emitter/operator evidence is supplied. Existing APW/SVRI fixtures are not silently
counted as new-format proofs. The scoped approval criterion is a proposal for the
owner, not an approved gate change or permission to start A/B or Phase 2.

## Solo pruebas — fixture material and scanner fingerprints

Every one of the **28 scanner entries** is labeled **solo pruebas** individually
in the repository scanner ledger. These are 28 finding fingerprints, **not 28
distinct private keys**: they refer to public original/mutated APW JWS, public
DNSKEY RDATA and key-set commitments, with duplicates across fixtures. All keys,
seeds, domains and clocks in this corpus are **solo pruebas**; never import them
as production identities, anchors, bearer credentials or configuration. Test
authoring/audit code may reproduce/reference them; no production source uses them.
A regression scans tracked production source for their literal public-key
coordinates, key IDs, seeds and excluded JWS/DNSKEY/digest values, and tests an
intentional reuse to prove detection. This is a source-literal check, not a claim
about external deployments, encoded/generated reuse or unknown future code.

**Editing a fixture requires regenerating its fingerprint**: after a reviewed,
versioned correction, recompute its SHA-256/JCS entry and affected corpus digest;
after committing, rerun the scanner and review its new commit/file/rule/line
fingerprint before replacing the exact exception. Regenerating an exception is
not automatic permission to suppress a new finding. Never disable a rule, exempt
the directory, or rewrite signed bytes simply to satisfy the scanner. Even an
unchanged fixture moved to a different introducing commit by a draft-history
rewrite needs newly reviewed scanner fingerprints; the content digests stay fixed.
