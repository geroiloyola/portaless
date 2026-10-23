# S3 coverage split — proposed approval scopes

**Status: Draft proposal, not approved. License: CC BY 4.0.**
This is a coverage/dependency review, not an implementation or a change to the
approved gate. No Phase 2 engine, network, budget or DNSSEC validator is supplied.
Fixture `proofAccepted` values are future targets, not observed engine verdicts.

## S3-core — proposed prerequisite for A and B

Scope: existing APW identity via configured validating DoH/AD, `did.json` and
bounded complete identity history; no reputation, score or offline DNSSEC claim.
File references below are corpus-relative to `vectors/ltp/v0.1/`.

| Core area | Existing target evidence | Still missing — blocking S3-core approval |
|---|---|---|
| Bootstrap/root binding | `valid-identity-only.json`, `forwarded-ad-not-a-root.json`, `invalid-key-binding.json`, `expired-root.json` | Conflicting TXT roots, malicious trust-policy/root replacement, rollback to known state, bootstrap unsupported/incomplete permutations. |
| TXT/DoH | `unsigned-dns.json`, `wrong-dns-question.json`; controlled local AD observation in `valid-proof-chain.json` | Wrong type, TC/truncation, NXDOMAIN/no TXT, bad status/TTL, ambiguous TXT, alias rejection, DoH failure and no-downgrade/fallback targets. No live DoH observation is demonstrated. |
| did.json | Signed manifest and DID/key fixture; substituted key negative | Subject/controller/kid substitution, duplicate/ambiguous verification methods, unsupported keys, private-key rejection and missing DID/history bindings. |
| History, rotation and several keys | `seq-gap.json`, changed key-window/expired key-set, valid continuation and two-step bootstrap, absent/expired checkpoint | **Rotations/multiple-key ordering**, key fingerprints/key IDs sorting/ties, retired-key windows, target changes/overlaps/restarts, checkpoint trust-policy changes and complete rollback/equivocation classes. Current positive chain uses one key only. |
| Service/error classes | Missing-null/string-null/unknown-member/request-ID/digest negatives; one incomplete result | Literal fixtures for **every service error class** in Serialization §6 and bootstrap failure class; HTTP/Retry-After combinations and unknown-version/profile cases. Schemas/prose alone are not targets. |
| Resource-bound objectives | Declared request limits and step-cap-one bootstrap target | **Complete resource-bound targets** at/over bytes, records, keys, signatures, steps, deadlines, shared/nested work, cancellation and retry/resume/no-reset. Define immutable expected failures first; measurements/accounting implementation belong to S2/S5. |

All six rows have missing cases. The core positive example is not a complete
core conformance suite. Strict-parser malformed inputs also remain rejection
targets; current byte/math/schema audits do not execute a strict LTP parser.

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
