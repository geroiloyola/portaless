# S3 coverage split — proposed approval scopes

**Status: G1 accepted 2026-10-24; G2/G3 implementation authorized, G4/G5 blocked. License: CC BY 4.0.**
The corpus is accepted for the identified static scope. A bounded identity-only
engine now consumes it under the separate [G2/G3 authorization](./LTP-G2-G3-IMPLEMENTATION-SCOPE.md).
No reputation, public SVRI profile or offline DNSSEC validator is supplied.
Fixture `proofAccepted` values remain the immutable acceptance targets.

## S3-core — proposed prerequisite for A and B

Scope: existing APW identity via configured validating DoH/AD, `did.json` and
bounded complete identity history; no reputation, score or offline DNSSEC claim.
Case links below identify their exact preserved corpus revision.

| Core area | Concrete v0.2 case IDs / set | Static coverage submitted for review |
|---|---|---|
| Bootstrap/root binding | [14 CORE-01 cases](./vectors/ltp/v0.2/core-01-bootstrap.json), e.g. `CORE-01-valid-root`, `CORE-01-package-policy-install`, `CORE-01-known-sequence-rollback` | Provisioned roots, forwarded/absent AD, root/key/policy substitution, freshness and known-state rollback/equivocation; TXT contradictions also in CORE-02. |
| TXT/DoH | [42 CORE-02 cases](./vectors/ltp/v0.2/core-02-doh.json), e.g. `CORE-02-conflicting-txt`, `CORE-02-truncated`, `CORE-02-transport-fallback` | Question/type/name, AD/TC, NXDOMAIN/no TXT, status/TTL, ambiguity, aliases, endpoint input, transport failure and no-downgrade/fallback targets. Transcripts are inert, not live observations. |
| did.json | [23 CORE-03 cases](./vectors/ltp/v0.2/core-03-did.json), e.g. `CORE-03-controller`, `CORE-03-private-key`, `CORE-03-duplicate-method` | Subject/controller/kid, duplicate/ambiguous methods, public/private/unsupported keys, missing references, signed claim substitution and actual signature mutation. |
| History, rotation and several keys | [46 CORE-04 cases](./vectors/ltp/v0.2/core-04-history.json), e.g. `CORE-04-rotation-valid`, `CORE-04-keys-reversed`, `CORE-04-long-1000-step-1/2/3` | **Rotations/multiple-key ordering**, legacy null keyId, alias/duplicates, inclusive key windows, chain failures, key-set preimages, checkpoints, policy/target changes, restart and three signed segments. |
| Service/error classes | [39 CORE-05 cases](./vectors/ltp/v0.2/core-05-errors.json) | All 14 core service reason classes and literal HTTP/Retry-After outputs, envelope/version/profile negatives, nine strict-parser targets. Expected parser/verifier outcomes are targets, not executed results. |
| Resource-bound objectives | [121 CORE-06 cases](./vectors/ltp/v0.2/core-06-resources.json), e.g. `CORE-06-dohBytes-at`, `CORE-06-signatureAttempts-over`, `CORE-06-abort-stream` | At/over limits, exact body recipes, count lists, cumulative requested work, cancellation, cache/dependency expiry and retry/resume/no-reset objectives. No scheduler/accounting/transport has been implemented. |

The initial v0.1 positive chain uses one key only and remains preserved. All six
rows have concrete static targets in the versioned candidate; the owner accepted
G1 on 2026-10-24 after `linstarkcorp` reviewed the composed v0.3 corpus. The
bounded identity-only engine verifies the seven composed targets; wider CORE
semantics, reputation and offline DNSSEC remain outside that implementation.
The complete [coverage index](./vectors/ltp/v0.2/coverage.json) lists all 285 new
IDs and literal reasons/stages, with full input/expected objects in the case sets.

The [CORE-01…06 closure plan](./LTP-S3-CORE-CLOSURE-PLAN.md) remains the review
checklist. If review finds any missing A/B prerequisite, approval of a digest
alone cannot waive it or start A/B. A target set is not a conformance report.

## Composed coverage added for the blocking review

The [v0.3 master and negatives](./vectors/ltp/v0.3/README.md) join the six component
areas rather than merely listing their IDs. [coverage.json](./vectors/ltp/v0.3/coverage.json)
contains all seven exact expected objects and contract references.

| Case | Composed coverage | Literal expected target |
|---|---|---|
| [AB-STATIC-01](./vectors/ltp/v0.3/ab-static-01.json) | CORE-01/02 recorded independent DoH → CORE-03 complete identity package → CORE-04 rotation/prefix states → CORE-05 candidate envelope → CORE-06 same scopes/deadline/counts | identity=verified, history=verified, proofAccepted=true; resourceGrant=false |
| [AB-STATIC-02](./vectors/ltp/v0.3/ab-static-02.json) | Failed A root prevents package consumption and B handoff | dnssec_required; history=not_started |
| [AB-STATIC-03](./vectors/ltp/v0.3/ab-static-03.json) | Genuine signed material and matching outer package hash, but DID public thumbprint differs from TXT k | key_mismatch; no log slice accepted |
| [AB-STATIC-04](./vectors/ltp/v0.3/ab-static-04.json) | Same A→B packet, then incompatible policy in B-LOG-2 input state | checkpoint_required; no splice/promotion |
| [AB-STATIC-05](./vectors/ltp/v0.3/ab-static-05.json) | A uses 5,000 ms; proposed bindings/log/gap use another 5,000 ms on the original 10,000 ms deadline | deadline_exceeded before B-LOG-2; no reset |
| [AB-STATIC-06](./vectors/ltp/v0.3/ab-static-06.json) | TTL=1 s is live at entry but expired at the 2 s final wall-clock target, within the operation deadline | freshness_unproven; no promotion |
| [AB-STATIC-07](./vectors/ltp/v0.3/ab-static-07.json) | Exact transfer and repaired outer commitments, but required log signature is a preserved one-bit mutation | bad_signature; history=invalid |

These are static targets, not observations. The reviewer decides sufficiency;
neither this table nor an audit lifts G1. All seven explicitly deny implementation
authorization and resource/reputation grants.

## S3-reputation — remains Draft

| Deferred area | Missing evidence / closure |
|---|---|
| `reader_conduct` issuers | Full issuer identity/chain/signature/window and completeness vectors, plus real distinct emitter/operator evidence before production reputation claims. |
| `(iss,jti)` | Conflicting distinct payloads, duplicate retransmission and deterministic selection/counting targets. |
| Community calibration | Admissible issuer age, calibration/provenance, weight and source-selection boundaries; real emitters do not replace deterministic vectors. |

Reputation evidence belongs to canonical **G4**. Advanced offline DNSSEC is a
distinct scope under **G5**, not part of the reputation work above. Its DS/anchor,
NSEC/NSEC3, wildcard and algorithm-rollover requirements are described only in
the [canonical gates register](./LTP-GATES-AND-AUTHORIZATIONS.md). Synthetic
RRSIG examples do not demonstrate full offline validation.

## Recorded S3-core approval criterion — G1 accepted

This matrix is evidence for **G1**, whose acceptance and current state are defined
only in [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).
Review must cover all core rows and their composition, with fixed keys/time,
literal outputs, direct contracts and byte-level producer/consumer bindings.
Any uncovered prerequisite remains a blocker even when hashes match.
The [approval record](./LTP-APPROVAL-RECORD.md) records the accepted G1 tuple.
G2/G3 required and received separate owner decisions; G1 alone did not open them.
This matrix remains a coverage document, not an implementation or an alternative
gate; it creates no G4/G5 permission.
