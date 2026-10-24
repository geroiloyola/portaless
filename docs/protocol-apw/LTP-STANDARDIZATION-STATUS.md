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
| S3 | Publish executable conformance vectors for all three new contracts with explicit authorship. | [v0.3 composed corpus](./vectors/ltp/v0.3/README.md) adds AB-STATIC-01…07 to preserved v0.2/v0.1. **G1 accepted 2026-10-24**; the bounded identity-only engine matches all seven literal targets. Candidate authorship remains **verificación cruzada (mismo autor)**; G4/G5 and S4/S6 remain open. |
| S4 | Obtain agreement from at least two independent verifiers. | Another person's verifier in another language with another primitive backend must record identity/revision/backend and complete results. OpenSSL CLI, Node/jose and cryptography/dnspython share the OpenSSL family; they cross-check encoding/canonicalization/structure, not primitive independence. This gate is still open. |
| S5 | Publish security/resource/privacy acceptance evidence. | Controlled HTTPS/DNS fixtures must demonstrate zero arbitrary-origin consumer calls, no silent fallback, authenticated issuer/root handling, bounded hostile input, expiry/revocation behavior and audience separation. Report acquisition and local verification separately. Runtime activation additionally needs actual adapter/integration evidence. |
| S6 | Publish a versioned normative release after S1–S5. | Record the final version/date, stable filenames and identifiers, dependency/errata references, vectors and verifier results; update status/index links consistently. Keep unchanged deployed identifiers and distinguish `apw-index` from the package service. Record the release through the normal reviewed PR and owner merge process. |

Final publication is a project-governed open specification release under
CC BY 4.0, not a claim of recognition by an external standards body. A document
can describe a contract before deployment; a runtime may advertise conformance
only for profiles whose complete requirements it actually passes.

## 3. Phase boundary and Edge gate

**Authorization source:** [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md)
is the sole G1–G5 register. This file retains S1–S6 milestones and does not define
another set of implementation permissions. **S1/S3-core were accepted under G1 on
2026-10-24**, including the composed A→B corpus.

The baseline PR #103 was merged by the owner on 2026-10-23. **PR #104 was reviewed
by linstarkcorp and merged at `7fd939f`**; that merge did not itself open G2/G3.
The owner then recorded separate bounded G2/G3 authorizations for the identity-only
acquisition/budget layer and deterministic verifier. The G4 decision-case engine is implemented and in final approval review; G5 remains blocked, and
no automatic transition is specified here. Deployment and wider runtime
acceptance still require the relevant S1–S6 evidence.

Deployment/runtime acceptance still requires the relevant S1–S6 evidence,
[LTP Index §8](./LTP-INDEX-DRAFT-v0.1.md#8-adoption-gate),
[LTP Proof Package §9](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md#9-required-independent-conformance-vectors)
and the [A/B/C plan](../architecture/resolution-chain-proposal.md). No standard,
runtime, reputation or offline-DNSSEC conformance is asserted by static fixtures.

Document-only approval changes no code, active defaults or deployed behavior.
Until final publication, the three filenames retain `DRAFT-v0.1` and their
headers identify the approved baseline plus remaining publication gates.
