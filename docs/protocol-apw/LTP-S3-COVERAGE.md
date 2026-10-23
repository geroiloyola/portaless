# S3 coverage split — proposed approval scopes

**Status: v0.2 static target set published for manual review, not approved. License: CC BY 4.0.**
This is a coverage/dependency review, not an implementation or a change to the
approved gate. No Phase 2 engine, network, budget or DNSSEC validator is supplied.
Fixture `proofAccepted` values are future targets, not observed engine verdicts.

## S3-core — proposed prerequisite for A and B

Scope: existing APW identity via configured validating DoH/AD, `did.json` and
bounded complete identity history; no reputation, score or offline DNSSEC claim.
File references below are corpus-relative to `vectors/ltp/v0.1/`.

| Core area | Concrete v0.2 case IDs / set | Static coverage submitted for review |
|---|---|---|
| Bootstrap/root binding | [14 CORE-01 cases](./vectors/ltp/v0.2/core-01-bootstrap.json), e.g. `CORE-01-valid-root`, `CORE-01-package-policy-install`, `CORE-01-known-sequence-rollback` | Provisioned roots, forwarded/absent AD, root/key/policy substitution, freshness and known-state rollback/equivocation; TXT contradictions also in CORE-02. |
| TXT/DoH | [42 CORE-02 cases](./vectors/ltp/v0.2/core-02-doh.json), e.g. `CORE-02-conflicting-txt`, `CORE-02-truncated`, `CORE-02-transport-fallback` | Question/type/name, AD/TC, NXDOMAIN/no TXT, status/TTL, ambiguity, aliases, endpoint input, transport failure and no-downgrade/fallback targets. Transcripts are inert, not live observations. |
| did.json | [23 CORE-03 cases](./vectors/ltp/v0.2/core-03-did.json), e.g. `CORE-03-controller`, `CORE-03-private-key`, `CORE-03-duplicate-method` | Subject/controller/kid, duplicate/ambiguous methods, public/private/unsupported keys, missing references, signed claim substitution and actual signature mutation. |
| History, rotation and several keys | [46 CORE-04 cases](./vectors/ltp/v0.2/core-04-history.json), e.g. `CORE-04-rotation-valid`, `CORE-04-keys-reversed`, `CORE-04-long-1000-step-1/2/3` | **Rotations/multiple-key ordering**, legacy null keyId, alias/duplicates, inclusive key windows, chain failures, key-set preimages, checkpoints, policy/target changes, restart and three signed segments. |
| Service/error classes | [39 CORE-05 cases](./vectors/ltp/v0.2/core-05-errors.json) | All 14 core service reason classes and literal HTTP/Retry-After outputs, envelope/version/profile negatives, nine strict-parser targets. Expected parser/verifier outcomes are targets, not executed results. |
| Resource-bound objectives | [121 CORE-06 cases](./vectors/ltp/v0.2/core-06-resources.json), e.g. `CORE-06-dohBytes-at`, `CORE-06-signatureAttempts-over`, `CORE-06-abort-stream` | At/over limits, exact body recipes, count lists, cumulative requested work, cancellation, cache/dependency expiry and retry/resume/no-reset objectives. No scheduler/accounting/transport has been implemented. |

The initial v0.1 positive chain uses one key only and remains preserved. All six
rows now have concrete static targets in the versioned candidate; **manual
coverage review and owner approval remain pending**. No LTP engine, strict parser,
network or budget implementation has executed the expected semantic outcomes.
The complete [coverage index](./vectors/ltp/v0.2/coverage.json) lists all 285 new
IDs and literal reasons/stages, with full input/expected objects in the case sets.

The [CORE-01…06 closure plan](./LTP-S3-CORE-CLOSURE-PLAN.md) remains the review
checklist. If review finds any missing A/B prerequisite, approval of a digest
alone cannot waive it or start A/B. A target set is not a conformance report.

## S3-reputation — remains Draft

| Deferred area | Missing evidence / closure |
|---|---|
| `reader_conduct` issuers | Full issuer identity/chain/signature/window and completeness vectors, plus real distinct emitter/operator evidence before production reputation claims. |
| `(iss,jti)` | Conflicting distinct payloads, duplicate retransmission and deterministic selection/counting targets. |
| Community calibration | Admissible issuer age, calibration/provenance, weight and source-selection boundaries; real emitters do not replace deterministic vectors. |
| Advanced DNSSEC | DS-chain policy/anchors, NSEC/NSEC3, wildcard/alias confusion and algorithm rollover. Parked here as deferred **optional offline-profile** work, not because DNSSEC is a reputation algorithm or requires reputation emitters. Only an approved audited-library adapter can later claim support. |

No new reputation or offline DNSSEC conformance is approved. S3-reputation stays
Draft until the deterministic suite is complete and real emitters exist for the
reputation claims; offline-profile review has its own library/operator evidence.
Synthetic signed RRSIG examples do not close advanced DNSSEC coverage.

## Proposed S3-core approval criterion — owner decision required

1. Complete every missing core row with fixed keys/time/policy, original bytes,
   expected positive/negative results, service failures and resource objectives.
   Demonstrate generation/canonicalization/structure cross-checks; disclose the
   shared OpenSSL backend and pending S4 independence. Do not claim an engine ran.
2. Recompute and review the schema/corpus/numeric digests, and bind the normative
   text commit in the [approval record](./LTP-APPROVAL-RECORD.md). Preserve old
   candidates; do not alter an expectation to make later implementation pass.
3. linstarkcorp reviews; the owner explicitly approves **S1 + S3-core for A/B
   only**, names the record, digests and text SHA, and authorizes that next phase.
   No approval is entered by this PR or by green CI. Until then A/B stay frozen.
4. If approved later, A (TXT/DoH) and B (did.json/history) may proceed without
   publishing the Index standard or completing S3-reputation. This does not
   activate a route, remove SSRF/TLS/budget acceptance, change approved limits or
   bypass the existing A → B → C gate before PR3. C/Index, S4/S6, scoring and
   advanced DNSSEC remain under their own unfinished gates.

The proposed split narrows a future authorization to identity work; it is not a
declaration that S3-core is closed, that S3-reputation can be waived, or that the
existing all-S1/S3 approval rule has already changed.
