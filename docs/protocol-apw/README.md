# LTP Stack — APW, LTP, SVRI/HSVR and Veranet

> Canonical English version. The Spanish archive is [`README_es.md`](./README_es.md).

Portaless is a reference implementation of the **LTP Stack**: APW for identity
and state structure, LTP for trust/evidence/traceability, SVRI for the consumable
output vector and HSVR for its verifiable historical record. The published APW
v1.3 document currently groups these contracts; the conceptual separation does
not silently change its signed artifacts, algorithms or adopted vectors.

See [LTP Stack architecture](./LTP-STACK-ARCHITECTURE.md) for layer ownership,
compatibility and the future `ltp-stack` / `ltp-protocols` repository direction.

**Phase closure (2026-10-23):** the owner approved the architecture and three
Draft 0.1 contracts as the implementation baseline, explicitly including the
independent identity root and restrictive resource budget. See
[contract approval and standardization gates](./LTP-STANDARDIZATION-STATUS.md)
for the final-publication checklist and the requirement to merge this documentation
before programming indexed egress for Workers/Edge. Runtime activation remains
subject to conformance and integration evidence.

**Protocol documentation**

| Document | Status |
|---|---|
| [`APW-SPEC-v1.3.md`](./APW-SPEC-v1.3.md) | **Current — consolidated normative specification** (v1.0 + v1.1 + v1.2 + errata E-1..E-10 integrated; witnesses in §5.7; ranking/filter semantics in §7.1). English canonical. **E-11..E-16 are normative and in effect but not yet consolidated** into the body — see [`ERRATA.md`](./ERRATA.md). |
| [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) | **Current — test vectors**, runtime-free assets; verificación cruzada (mismo autor), no external review claimed |
| [`SVRI-v1.0.md`](./SVRI-v1.0.md) | **Normative LTP supplement (E-16)** — evidence tiers, inference flags, qualitative public projection and admin-only HSVR |
| [`vectors/svri/v1.0/`](./vectors/svri/v1.0/) | SVRI v1.0 projection vectors; verificación cruzada (mismo autor), no external review claimed |
| [`STARTER-KIT.md`](./STARTER-KIT.md) | **Guide for external implementers** — language-agnostic, pseudocode, no Portaless code required |
| [`ERRATA.md`](./ERRATA.md) | Historical record of corrections; E-13..E-16 are normative and in effect as supplements |
| [`APW-SPEC-v1.3_es.md`](./APW-SPEC-v1.3_es.md), [`APW-VECTORS-v1.3_es.md`](./APW-VECTORS-v1.3_es.md) | Spanish archival copies of the current specification and vectors |
| [`APW-SPEC-v1.2.md`](./APW-SPEC-v1.2.md), [`APW-SPEC-v1.0.md`](./APW-SPEC-v1.0.md) | Superseded versions / citable prior art (Spanish) |
| [`apw-spec.md`](./apw-spec.md) | Historical conceptual summary, superseded |

## Proposed resolution contracts (not yet adopted or implemented)

The standard names **LTP Index**, **LTP Proof Package**,
**LTP Attestation** and **SVRI Projection** are protocol-neutral. Portaless is a
reference runtime, not the name of a protocol service or data format.

| Draft | Contract |
|---|---|
| [LTP Index Draft 0.1](./LTP-INDEX-DRAFT-v0.1.md) | Configured trust-proof distribution service, request/result messages, limits and failure semantics. |
| [LTP Proof Package Draft 0.1](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md) | Canonical proof container, APW identity/state proofs, LTP Attestations, SVRI Projection recomputation and resumable bootstrap. |
| [APW Identity Bootstrap Draft 0.1](./APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md) | Independent DoH/AD or locally verified DNSSEC; explicit trust/freshness boundaries. |
| [S1 serialization and schemas](./LTP-SERIALIZATION-DRAFT-v0.1.md) | Exact hash inputs, null/HTTP semantics, signed integers and unsigned SVRI numerics. Candidate, not approved. |
| [S3 static corpus](./vectors/ltp/v0.1/README.md) | Same-author cross-check plus third-party signature tools; coverage blocks corpus approval. |
| [Artifact classification](./LTP-ARTIFACT-CLASSIFICATION.md) | Deterministic core, optional profiles, runtime and grant-only PR3 dependencies; Draft. |
| [Extraction preparation](./LTP-EXTRACTION-PLAN.md) | Standalone package, link lint, future release/digest plan; no extraction executed. |
| [Approval record](./LTP-APPROVAL-RECORD.md) | Candidate data digests plus exact normative-text commit; no owner decision entered. |
| [S3 scoped coverage](./LTP-S3-COVERAGE.md) | Core gaps and proposed A/B approval criterion; reputation remains Draft. |
| [CI/protection observation](./LTP-CI-REVIEW.md) | Which jobs run checks, observed required contexts, and a proposal only. |

These owner-approved baseline drafts do not amend the adopted APW v1.3/E-16 formats, rename existing wire
messages, or establish conformance. Machine-readable vectors with explicit
authorship and externally reviewed compatible implementations are required before activation. No runtime
source import, hosting vendor or central Index is a protocol prerequisite.

Current S1/S3 tools are **verificación cruzada (mismo autor)**. References to an
independent DNS root mean independent **of the Index**, not another human author;
requirements for independent S4 verifiers are still unsatisfied. No external
person's review is implied by using Python, Node, OpenSSL, JOSE or dnspython.

## Integration and implementation

**S1/S3, vector-first phase:** [exact serialization and JSON schemas](./LTP-SERIALIZATION-DRAFT-v0.1.md)
and [static cryptographic/mathematical vectors](./vectors/ltp/v0.1/README.md) are
submitted for owner review. Engine programming requires both merger of the
architecture baseline and approval of S1/S3. The fixture audit is not a runtime
conformance report or a second complete verifier.

**Integrator guide**: third parties connecting to APW / Portaless / Index APIs should start at [`docs/api/`](../api/) (public well-known endpoints, verification recipes, admin endpoints).

**License and governance**: the specification, its errata, and its vectors are published under **CC BY 4.0** — reimplementation, translation, and commercial use are permitted with attribution to the author (Gerardo Loyola), with no registration or certification by Portaless; see the [License and governance](./APW-SPEC-v1.3.md#license-and-governance) section of the spec. The reference implementation code is AGPL-3.0 (`LICENSE`). Section 6 is called **Loyal Trust Protocol (LTP)**; in earlier versions of the document it appeared as "Loyola Trust Protocol" (same acronym, same specification).

**The problem it solves**: today no complete, decentralized, free technical mechanism exists that lets an AI agent (or a human) verify whether a site is trustworthy without depending on a high-reputation domain, a central certifying authority, or circumventable proxy signals.

**How it solves it**: each site publishes its cryptographic identity (Ed25519, RFC 9421) and a public `SiteTrustScore` computed from 4 independent, auditable sources — self-declaration, AI-agent verification, community voting, and external custody reports. The whole design is crypto-agile and post-quantum-ready from the database schema up (the `key_algorithm` column allows a future migration to ML-DSA / FIPS 204 without losing the chain of custody).

**Veranet**: the target network of independently operated sites using APW
identity/state proofs, LTP evidence evaluation and SVRI outputs, discovered
through interchangeable **LTP Index** services. It is not a central authority or
a network already proven to exist. Cryptographic provenance does not establish
truth, prevent every omission or make an unavailable source verifiable.

**Real implementation status** (verifiable by commit, not by promise): the
reference runtime implements DNS-over-HTTPS resolution, `did:apw` identity/key
rotation, signed artifacts, DNS-anchored APW history, LTP scoring/read governance
and local witness aggregation. The existing `/.well-known/apw-index.json`
message is a historical witness-directory format, not the new **LTP Proof Package**
service. Package paths remain implementation details; see [`ROADMAP.md`](../../ROADMAP.md)
for current limitations. The Draft 0.1 contracts above are not implemented.

Original APW specification publication date: **September 2026**. The three new
Draft 0.1 contracts have baseline approval dated **2026-10-23**; their final
normative publication remains subject to the gates above.
