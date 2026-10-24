# Closing S3-core — evidence before authorization to start A/B

**Status: static G1 correction authorized; composed v0.3 awaits manual review. License: CC BY 4.0.**
LTP means **Local Trust Protocol**: each node applies its own policy to verified
evidence. This plan does not implement a verifier, transport, quota or DNSSEC
validator, approve a corpus, or open Phase 2. The owner controls that decision.

## What is missing for A/B

The [six core rows](./LTP-S3-COVERAGE.md#s3-core--proposed-prerequisite-for-a-and-b)
all contain dependencies of A or B. The execution instruction authorized static
target generation and CI consolidation only. [Candidate v0.2](./vectors/ltp/v0.2/README.md)
now supplies 285 cases; the following IDs still identify **work packages**, not
claims that an A/B implementation passed them. Review may identify gaps; none
can be deferred to reputation merely to approve a digest.

The blocking review also requires a composed case. The
[v0.3 master and negatives](./vectors/ltp/v0.3/README.md) provide producer/consumer
bytes, inherited CORE evidence, policy/root/target joins, shared resource facts
and literal terminal outputs. Review them against every work package below;
sufficiency remains a human G1 decision, not a hash result.

| Work ID | Consumer | Static evidence required before closing the row |
|---|---|---|
| CORE-01 | A and B: authenticated bootstrap | Positive identity-only root plus conflicting TXT roots, key/root substitution, malicious policy/anchor replacement, expired root, known-state rollback and supported/unsupported/incomplete outcomes. Consumer-owned policy/time/roots must be explicit. |
| CORE-02 | A: TXT/DoH | Fixed request/response transcripts for AD/TC, exact question/type, DNS status and TTL boundaries, no TXT/NXDOMAIN, conflicting TXT, alias rejection, resolver failure, no-downgrade/fallback and redirect/SSRF rejection objectives. Controlled fixtures are not a live DoH observation or runtime adapter result. |
| CORE-03 | B: did.json | Valid domain/DID/current-key binding and subject/controller/kid substitution, duplicate/ambiguous methods, unsupported/private keys, absent bindings and identity/history reference mismatches. No self-authentication from an Index key. |
| CORE-04 | B: history and keys | Actual signed multi-key/rotation histories, sorting and tie/duplicate rules, retired-key windows, seq/prev/timestamp/anchor consistency, rollback/equivocation, resumable target changes/overlaps/restarts, expired checkpoints and policy changes. A one-key chain cannot demonstrate rotation. |
| CORE-05 | A and B: errors | Literal positive/negative envelopes and transcript expectations for every selected core bootstrap/service error, strict-parser rejection, profile/version/identity/request bindings, status/reason/HTTP and Retry-After absent-versus-integer combinations. No negative reputation from infrastructure failure. |
| CORE-06 | A and B: resource objectives | At/over boundaries for bytes, records, imports, signature work, steps, deadlines and shared/nested work; cancellation, concurrency and retry/resume/cache-hit no-reset expectations against approved limits. These are accounting/transport **test objectives**, not an implemented scheduler or measured runtime sufficiency. |

Use the approved [resource-limit baseline](../architecture/resolution-chain-proposal.md#approved-resource-limits).
If an expected outcome or accounting rule is ambiguous, resolve and review that
contract question first. Do not invent a fixture result by running an unfinished
engine, or alter a signed golden byte to accommodate later code.

## Closure procedure (still S1/S3, no Phase 2)

1. **Make coverage explicit.** For each CORE-01…06 requirement, list concrete
   positive/negative fixture IDs, invariant/expected failure, relevant contract
   section and A/B dependency. Classify missing, fixture-defined/cross-checked and
   externally reviewed separately. An empty row, prose example or schema enum is
   not executable coverage. First-use roots and already-known checkpoints need
   distinct cases; add boundary cases rather than only happy paths.
2. **Author versioned static candidates.** Use fixed test keys, trusted time,
   local policy, transcript bytes, signatures and literal expected outputs. Keep
   the current 41 assets and numerical extension as the old candidate; a future
   completed-core candidate needs its own reviewed/versioned manifest and digest.
   The authorized static revision publishes the new total-corpus digest while
   preserving the original corpus, schema bundle and numeric extension.
3. **Check the assets without claiming engine conformance.** Validate schemas,
   exact signing/hash preimages, numeric serialization, mutations and resource
   objective consistency. Cross-check encodings through current tools and report
   discrepancies and the shared OpenSSL limitation. S4 remains responsible for
   a different person's implementation/language/backend; these asset checks do
   not falsely claim to execute the future strict parser, network or budget.
4. **Review the coverage against A/B.** linstarkcorp must review every dependency
   above, including cases spanning A → B. Any missing prerequisite keeps both
   deliveries blocked; marking a digest approved cannot override that finding.
   The owner selected consolidation in the already-required `Unit Tests / unit`
   job. The standalone checks now run there without a separate GitHub check;
   protection settings and strict coverage thresholds are unchanged.
5. **Bind and submit G1.** Once all core requirements and their composition have
   concrete reviewed targets, regenerate the candidate tuple and normative-prose
   SHA. Submit only corpus sufficiency to the owner. This is not a request or
   permission to implement. The sole authorization definitions/states are in
   [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).

## Implementation is outside this closure work

Future controlled-runtime evidence (TLS/SSRF, streaming/cancellation, shared
accounting and measurements) belongs to separately authorized work, not this
static correction. No transition to it follows from corpus approval or merge.
G2–G5 scopes and states are not redeclared here: consult the canonical register.
S4/S6 and the original A → B → C-before-PR3 sequence retain their existing
requirements. Static targets are neither runtime evidence nor implementation.
