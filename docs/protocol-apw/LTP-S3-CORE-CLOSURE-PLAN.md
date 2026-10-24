# Closing S3-core — accepted evidence and bounded G2/G3 implementation

**Status: G1 accepted 2026-10-24; bounded G2/G3 implementation authorized; G4 decision-case engine implemented and in final approval review; G5 blocked. License: CC BY 4.0.**
LTP means **Local Trust Protocol**: each node applies its own policy to verified
evidence. The accepted corpus is now consumed by a bounded identity-only
acquisition/budget layer and deterministic verifier. This plan does not authorize
reputation, offline DNSSEC, deployment activation or a normative release.

## What is missing for A/B

The [six core rows](./LTP-S3-COVERAGE.md#s3-core--proposed-prerequisite-for-a-and-b)
all contain dependencies of A or B. [Candidate v0.2](./vectors/ltp/v0.2/README.md)
supplies 285 cases; the following IDs identify **work packages**, not claims that
the bounded implementation passed every static target. G1 is accepted for the
identified corpus, and the owner separately authorized G2/G3 for identity-only
work. Review may identify gaps; none can be deferred to reputation.

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

## Closure procedure (G1 accepted; bounded implementation only)

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
5. **Record G1 and the separate authorization.** The owner accepted the corpus on
   2026-10-24 and separately authorized bounded G2/G3 work. The tuple is recorded
   in [LTP-APPROVAL-RECORD.md](./LTP-APPROVAL-RECORD.md). The sole authorization
   definitions/states are in
   [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).

## Bounded implementation, not autonomous expansion

Future controlled-runtime evidence (TLS/SSRF, streaming/cancellation, shared
accounting and measurements) still needs its own acceptance. No transition to it
follows from corpus approval or merge; G2/G3 required a separate owner decision.
G4/G5 scopes and states are not redeclared here: consult the canonical register.
S4/S6 and the original A → B → C-before-PR3 sequence retain their requirements.
Static targets are neither runtime evidence nor a deployment authorization.
