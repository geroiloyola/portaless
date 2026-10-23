# LTP Stack — contract approval and standardization gates

**Approval date:** 2026-10-23. **License:** CC BY 4.0.
**Status:** owner-approved architecture and Draft 0.1 contract baseline;
final normative publication and implementation conformance remain pending.

This records the owner's explicit approval of the documented decisions,
especially the independent DNS/DoH identity root and the single restrictive
resource-budget table. It closes the architectural decision phase. Approval
does not supply executable vectors, a second verifier or runtime integration.
The existing adoption gates in the three contracts remain in force.

## 1. Approved baseline

| Item | Approved decision | Boundary |
|---|---|---|
| Layer ownership | APW: `did:apw`, domain/key binding, signed artifacts, state structure and DNS-anchored log. LTP: chain/evidence/witness audits and trust/traceability rules. SVRI: versioned consumable projection. HSVR: verifiable history/reconstruction of SVRI, not the APW log. | [LTP Stack architecture](./LTP-STACK-ARCHITECTURE.md). |
| Runtime independence | Portaless names only a reference runtime/implementation. Protocols and formats have no dependency on its private APIs, database or source. | Independent engines use the same proofs, explicit trust policy, rules and evaluation time. |
| Standard names | LTP Index, LTP Proof Package, `ltp-resolution-request`, `ltp-resolution-result`, `ltp-proof-package`. Former APW-prefixed names of these unpublished drafts are not aliases. | Existing `typ: apw-index`, `apw-log+jws`, `apw-attestation+jws`, `did:apw` and routes remain unchanged. `apw-index` is the historical witness directory, not the new package service. |
| Independent root / D1–D3 | Authenticate each required APW identity independently of the Index before accepting its proofs. Use explicitly configured independent DoH/AD or local offline DNSSEC validation. | No forwarded AD, self-authenticating Index key, silent downgrade or arbitrary-origin completion. Offline DNSSEC is not proof of a current online observation. |
| History / D4–D5 | Bounded resumable progress, separated from trusted checkpoints; explicit operational, incomplete and cryptographic failure classes. | Unanchored prefixes do not authorize. Limits and infrastructure failure are not misconduct. |
| Cache / D6 | Short, inherited, non-sliding expiry; no stale-on-error or compounded local cache windows. | Preserve upstream DNS/replay limitations; no promise of instantaneous revocation. |
| Resource budget / D7 | The [single limits table](../architecture/resolution-chain-proposal.md#approved-resource-limits) is the restrictive implementation baseline for network, bytes, crypto work, cache, concurrency and time. | Estimates are approved bounds, not measured sufficiency or defaults already deployed. All nested work shares its budget; changing approved bounds requires a recorded decision. |
| Consumers / D8–D9 | A → B → C before PR3; both trust routes share a verification engine and budget. Edge-first ingress plus approximate per-instance quotas. | No new reputation admission, R-05 activation, global quota guarantee or independent-emitter claim. |

## 2. Remaining gates for final standard publication

The following is the closure checklist, not a claim that work has been completed.
The owner's approval above remains valid while these technical gates are met.
Any newly necessary change in trust semantics or approved limits returns to the
owner for a decision rather than silently changing the baseline.

| ID | Required closure | Current finding / evidence to publish |
|---|---|---|
| S1 | Complete unambiguous interoperability definitions. | Pin exact serialization for the APW TXT manifest hashed by `rootManifestDigest`; complete nested schema/type constraints and status/reason/null/HTTP combinations. Publish valid and invalid examples so independent engines do not infer local runtime structures. |
| S2 | Specify and test comprehensive budget accounting. | The numerical baseline is approved. Define how package/decoded DNS bytes, DNSSEC operations, manifest/key-set signatures, nested issuers, retries and resumed steps consume it; prove shared caps, cancellation and no reset on a cache hit/retry. This accounting must not create a bypass around the approved limits. |
| S3 | Publish executable conformance vectors for all three new contracts with explicit authorship. | Candidate is **verificación cruzada (mismo autor)**, not independent review. Fixed keys, clocks, roots, policy, original bytes and expected errors are present; [coverage blockers](./vectors/ltp/v0.1/README.md#approval-and-coverage-boundary) prevent approval/closure. Existing APW/SVRI vectors do not cover the new formats. |
| S4 | Obtain agreement from at least two independent verifiers. | Another person's verifier in another language with another primitive backend must record identity/revision/backend and complete results. OpenSSL CLI, Node/jose and cryptography/dnspython share the OpenSSL family; they cross-check encoding/canonicalization/structure, not primitive independence. This gate is still open. |
| S5 | Publish security/resource/privacy acceptance evidence. | Controlled HTTPS/DNS fixtures must demonstrate zero arbitrary-origin consumer calls, no silent fallback, authenticated issuer/root handling, bounded hostile input, expiry/revocation behavior and audience separation. Report acquisition and local verification separately. Runtime activation additionally needs actual adapter/integration evidence. |
| S6 | Publish a versioned normative release after S1–S5. | Record the final version/date, stable filenames and identifiers, dependency/errata references, vectors and verifier results; update status/index links consistently. Keep unchanged deployed identifiers and distinguish `apw-index` from the package service. Record the release through the normal reviewed PR and owner merge process. |

Final publication is a project-governed open specification release under
CC BY 4.0, not a claim of recognition by an external standards body. A document
can describe a contract before deployment; a runtime may advertise conformance
only for profiles whose complete requirements it actually passes.

## 3. Phase boundary and Edge gate

**Subsequent owner instruction — cryptographic TDD:** execute S1/S3 first
([serialization/schema candidate](./LTP-SERIALIZATION-DRAFT-v0.1.md),
[static corpus and coverage](./vectors/ltp/v0.1/README.md)); do not program the
engine, network acquisition or production budgets until these vectors are
approved. Corpus coverage review remains part of S3. This is an additional
prerequisite, not a replacement for the documentary merge gate below.

The baseline PR #103 was merged by the owner on 2026-10-23. Its documentary
merge gate is satisfied; **S1/S3 owner approval remains blocked by missing S3
coverage**. This draft adds same-author cross-checks, not an S4 verifier, and
does not start Phase 2. Minimal bootstrap scope is configured DoH/AD; offline
DNSSEC is a future optional audited-library profile, not supplied by these tools.

The [S3-core / S3-reputation split](./LTP-S3-COVERAGE.md) proposes explicit owner
approval of S1 + complete S3-core as a narrower gate for A/B only. **Not approved
or implemented:** current approval rules still apply. S3-reputation remains Draft
until its coverage and real-emitter evidence exist; advanced DNSSEC retains its
separate optional-library requirements. Any future approval must identify the
three digests and normative text SHA in the [approval record](./LTP-APPROVAL-RECORD.md).

1. **Before this documentation commit is merged into `main`:** indexed-egress
   implementation for Workers/Edge is blocked. A local commit or open PR does
   not satisfy the merge gate. The merge must contain this approved baseline;
   materially different revisions need renewed approval.
2. **After merge and owner approval of S1/S3:** the next phase is exclusively the engine and its associated
   conformance/acceptance work needed to meet these contracts and the approved
   restrictive budget. It does not authorize a different trust model, unrelated
   features, PR3 or reputation admission.
3. **Before activation or advertising production Edge support:** satisfy the
   relevant adoption gates above and the actual runtime integration gates in
   [LTP Index §8](./LTP-INDEX-DRAFT-v0.1.md#8-adoption-gate),
   [LTP Proof Package §9](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md#9-required-independent-conformance-vectors)
   and the [A/B/C plan](../architecture/resolution-chain-proposal.md). Merge
   permission to start programming is not permission to enable the route.

Document-only approval changes no code, active defaults or deployed behavior.
Until final publication, the three filenames retain `DRAFT-v0.1` and their
headers identify the approved baseline plus remaining publication gates.
