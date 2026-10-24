# LTP gates and authorizations — canonical scope register

**Status: current objective G1 only; PR #104 remains Draft. License: CC BY 4.0.**
This is the single definition of G1–G5, their scopes and current authorization
states. Other live documents reference this register instead of defining another
permission table. LTP means Local Trust Protocol: local policy over verified evidence.

## Canonical gates

| Gate | Scope and acceptance condition | Current state | Effect of a future decision |
|---|---|---|---|
| **G1** | **S3-core corpus approval.** Sufficient reviewed CORE-01…06 coverage plus the composed A→B master/negatives, exact data/prose commitments and explicit owner acceptance. A matching digest is necessary for identifying data, not proof of sufficient coverage. | **PENDING_REVIEW** | Accepts only the identified static corpus scope. The decision is recorded in `LTP-APPROVAL-RECORD.md`; it grants no implementation permission. |
| **G2** | **Acquisition, network and budgets.** A future owner decision must separately name the permitted transport/resource scope, revision and required acceptance work. Includes network/budget work even when located in a roadmap B delivery. | **BLOCKED** | Only a later explicit G2 authorization can permit that named work; it does not authorize the verifier or reputation/DNSSEC profiles. |
| **G3** | **Verification engine.** A future, separate owner decision must identify the deterministic verification scope and revision. No inference from G1 or G2 is allowed. | **BLOCKED** | Only a later explicit G3 authorization can permit the named engine work; it grants no network or budget permission. |
| **G4** | **S3-reputation and advanced mathematical profiles.** Reader-conduct issuers, `(iss,jti)`, calibration/provenance and advanced SVRI/HSVR profile targets require their own coverage and review; real reputation claims also need real emitter evidence. | **BLOCKED** | No new profile implementation, conformance or activation is approved here. Existing adopted SVRI v1.0 formulas and behavior are not disabled or rewritten. |
| **G5** | **Advanced offline DNSSEC.** DS/anchor policy, NSEC/NSEC3, wildcard and algorithm rollover need their own targets, audited/reviewed-library evidence and explicit scope decision. Configured DoH/AD and synthetic RRSIG signatures do not satisfy this scope. | **BLOCKED** | No custom validator, offline-profile implementation, conformance or activation is approved here. |

## Decision semantics — no automatic transitions

**Only G1 is being worked on in this PR. G1 is not approved. G2, G3, G4 and G5
are strictly blocked, and authorization to start their implementation is denied
in this change.** Approval of the correction plan authorizes static assembly,
documentation and asset checks, not approval of the resulting corpus.

- G1 acceptance never opens G2, G3, G4 or G5. A future G2 decision never opens G3,
  and a G3 decision never opens G2. Each decision has its own explicit owner scope.
- Hash equality, a signed artifact, a record tuple, green CI, PR approval/merge,
  candidate publication or the existence of a test does not grant implementation
  authority. No code or document may infer it from those events.
- Missing A/B coverage still blocks G1 even if all commitments match. Candidate
  expected results are not observed outcomes of a running LTP engine.
- Future implementation decisions require explicit, separate, later owner
  authorization. They are outside this PR; neither the agent nor CI enters them.

## A/B terminology and existing milestones

In the composed fixture **A = acquisition role** and **B = offline verification
role**. These are data-flow roles, not a rename of the existing roadmap deliveries
A (TXT/DoH), B (did.json/history) and C (evidence). The functional scopes above
remove ambiguity: all new transport/budget implementation falls under G2 and all
new engine implementation under G3, regardless of module or delivery label.

S1–S6 remain standardization milestones, not a competing authorization register.
S4 still requires independent verifier/person/language/backend evidence; S6 still
requires its normative publication prerequisites. Neither is satisfied by G1,
the composed static trace or current OpenSSL-family cross-checks. The existing
A → B → C-before-PR3 sequencing and deployment acceptance requirements remain.
The already-merged PR #103 baseline is historical architecture approval, not an
outstanding permission switch and not authorization to start any implementation.

## Evidence ownership and current-cycle boundary

The [approval record](./LTP-APPROVAL-RECORD.md) stores the candidate commitments
and `ownerDecision` for **G1 only**. Even a future G1 decision is not a G2–G5
authorization. Their current states are defined only by the canonical table above.

Permitted in this cycle: static fixture assembly/versioning, literal expected
results, hashes/signatures, schema and byte/algebra assertions, documentation and
CI checks. No supplied A/B transcript is sent. No resolver, strict LTP parser,
workflow executor, scheduler, budget manager or verification engine is written,
modified or enabled. Existing application tests are not execution of this trace.
The reviewer/owner must decide sufficiency; these checks cannot lift the blocker.
