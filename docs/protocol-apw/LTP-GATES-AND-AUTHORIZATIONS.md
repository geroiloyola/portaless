# LTP gates and authorizations — canonical scope register

**Status: G1 accepted; G2 and G3 authorized for a bounded identity-only
implementation; G4 and G5 remain blocked. License: CC BY 4.0.**
This is the single definition of G1–G5, their scopes and current authorization
states. Other live documents reference this register instead of defining another
permission table. LTP means Local Trust Protocol: local policy over verified evidence.

## Canonical gates

| Gate | Scope and acceptance condition | Current state | Effect of a decision |
|---|---|---|---|
| **G1** | **S3-core corpus approval.** Sufficient reviewed CORE-01…06 coverage plus the composed A→B master/negatives, exact data/prose commitments and explicit owner acceptance. A matching digest is necessary for identifying data, not proof of sufficient coverage. | **ACCEPTED** (2026-10-24) | Accepts only the identified static corpus scope. The decision is recorded in `LTP-APPROVAL-RECORD.md`; G1 alone grants no implementation permission. |
| **G2** | **Acquisition, network and budgets.** A future owner decision must separately name the permitted transport/resource scope, revision and required acceptance work. Includes network/budget work even when located in a roadmap B delivery. | **AUTHORIZED** (2026-10-24, bounded) | Only the named identity-only acquisition and budget work may proceed. It does not authorize the verifier by itself, reputation/DNSSEC profiles or deployment activation. |
| **G3** | **Verification engine.** A future, separate owner decision must identify the deterministic verification scope and revision. No inference from G1 or G2 is allowed. | **AUTHORIZED** (2026-10-24, bounded) | Only the named deterministic identity verifier may proceed. It grants no network/budget permission beyond G2 and no reputation or offline-DNSSEC permission. |
| **G4** | **S3-reputation and advanced mathematical profiles.** Reader-conduct issuers, `(iss,jti)`, calibration/provenance and advanced SVRI/HSVR profile targets require their own coverage and review; real reputation claims also need real emitter evidence. | **BLOCKED** | No new profile implementation, conformance or activation is approved here. Existing adopted SVRI v1.0 formulas and behavior are not disabled or rewritten. |
| **G5** | **Advanced offline DNSSEC.** DS/anchor policy, NSEC/NSEC3, wildcard and algorithm rollover need their own targets, audited/reviewed-library evidence and explicit scope decision. Configured DoH/AD and synthetic RRSIG signatures do not satisfy this scope. | **BLOCKED** | No custom validator, offline-profile implementation, conformance or activation is approved here. |

## Recorded owner decision — 2026-10-24

- **G1 accepted.** The owner confirms the v0.3 composed corpus
  (`wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA`), normative prose
  `07efe1a69fa9a4a12616edfe93106f28429deb87`, `linstarkcorp`'s approval at
  `3ff080b42481e9321b449cec6e4e78ae5a9c9653` and the merge at
  `7fd939fda0e2570e5c18dfbe0e555483b52b449f`. S1 and S3-core are closed.
- **G2 authorized, bounded.** Implement configured HTTPS DoH/TXT acquisition,
  configured Index package acquisition, and a strict shared resource/deadline
  budget under the approved D7 ceilings. The scope excludes redirect following,
  unsigned fallback, DNSSEC downgrade, unconfigured origins, production
  activation and changes to deployment quotas. See
  [G2/G3 implementation scope](./LTP-G2-G3-IMPLEMENTATION-SCOPE.md).
- **G3 authorized, bounded.** Implement a deterministic offline verifier that
  consumes the LTP Proof Package bytes for `apw-identity-proof-v1`, verifies the
  Ed25519/JCS artifacts, the authenticated TXT key binding and full history, and
  matches AB-STATIC-01…07. The scope excludes G4/G5 and any claim of S4
  independence.
- **G4 and G5 remain blocked.** This decision authorizes no public reputation
  mathematics, advanced SVRI/HSVR profile, DS-chain validation, NSEC/NSEC3,
  wildcard handling, algorithm-rollover work, custom offline validator or
  deployment activation.
- The authorization revision starts from `main` at
  `7fd939fda0e2570e5c18dfbe0e555483b52b449f`. Code changes use the normal PR,
  review and owner-merge process. The owner may narrow or revoke this scope in a
  later recorded decision.

## Decision semantics — no automatic transitions

- G1 acceptance did not open G2 or G3. Those are separate, later, explicitly
  bounded owner decisions recorded above.
- G2 and G3 do not open G4 or G5. A future G4 decision never opens G5, and a G5
  decision never opens G4. Each decision has its own explicit owner scope.
- Hash equality, a signed artifact, a record tuple, green CI, PR approval/merge,
  candidate publication or the existence of a test does not grant scope beyond
  the recorded decision. The owner decision, not the artifact, is the authority.
- Missing A/B coverage still blocks G1; it is accepted here for the identified
  corpus, not for every future vector. Candidate expected results are not
  observations of a different engine implementation.
- Any expansion of G2/G3 (new transport, shared cross-instance quota, other
  profile, deployment activation) requires a later explicit owner decision.

## A/B terminology and existing milestones

In the composed fixture **A = acquisition role** and **B = offline verification
role**. These are data-flow roles, not a rename of the existing roadmap deliveries
A (TXT/DoH), B (did.json/history) and C (evidence). The functional scopes above
remove ambiguity: all new transport/budget implementation falls under G2 and all
new engine implementation under G3, regardless of module or delivery label.

S1–S6 remain standardization milestones, not a competing authorization register.
S4 still requires independent verifier/person/language/backend evidence; S6 still
requires its normative publication prerequisites. Neither is satisfied by G1,
G2/G3, the composed static trace or current OpenSSL-family cross-checks. The
existing A → B → C-before-PR3 sequencing and deployment acceptance requirements
remain. The already-merged PR #103 baseline is historical architecture approval.

## Evidence ownership and current-cycle boundary

The [approval record](./LTP-APPROVAL-RECORD.md) stores the candidate commitments
and `ownerDecision` for **G1 only**. Even the G1 decision is not a G2–G5
authorization; the separate decision above is. Their current states are defined
only by the canonical table.

Permitted under the bounded G2/G3 authorization: configured HTTPS DoH/TXT and
Index acquisition, strict local budget/deadline accounting, deterministic
identity-only verification of supplied LTP package bytes, tests and
documentation. No supplied A/B transcript is sent by the static test harness.
No G4/G5 profile, offline DNSSEC validator, reputation math, release or
deployment activation is included. The reviewer/owner still decide acceptance;
these checks cannot expand the recorded scope.
