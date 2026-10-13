# Protocol APW and Veranet

> Canonical English version. The Spanish archive is [`README_es.md`](./README_es.md).

Portaless is the reference implementation of **Protocol APW (Air Portal Website)**: an open protocol for cryptographic identity and verifiable trust for independent websites, formally published in September 2026.

**Protocol documentation**

| Document | Status |
|---|---|
| [`APW-SPEC-v1.3.md`](./APW-SPEC-v1.3.md) | **Current — consolidated normative specification** (v1.0 + v1.1 + v1.2 + errata E-1..E-10 integrated; witnesses in §5.7). English canonical. |
| [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) | **Current — test vectors**, in a file independent of the code |
| [`STARTER-KIT.md`](./STARTER-KIT.md) | **Guide for external implementers** — language-agnostic, pseudocode, no Portaless code required |
| [`ERRATA.md`](./ERRATA.md) | Historical record of corrections E-1 to E-10 (Spanish); integrated into v1.3 |
| [`APW-SPEC-v1.3_es.md`](./APW-SPEC-v1.3_es.md), [`APW-VECTORS-v1.3_es.md`](./APW-VECTORS-v1.3_es.md) | Spanish archival copies of the current specification and vectors |
| [`APW-SPEC-v1.2.md`](./APW-SPEC-v1.2.md), [`APW-SPEC-v1.0.md`](./APW-SPEC-v1.0.md) | Superseded versions / citable prior art (Spanish) |
| [`apw-spec.md`](./apw-spec.md) | Historical conceptual summary, superseded |

**Integrator guide**: third parties connecting to APW / Portaless / Index APIs should start at [`docs/api/`](../api/) (public well-known endpoints, verification recipes, admin endpoints).

**License and governance**: the specification, its errata, and its vectors are published under **CC BY 4.0** — reimplementation, translation, and commercial use are permitted with attribution to the author (Gerardo Loyola), with no registration or certification by Portaless; see the [License and governance](./APW-SPEC-v1.3.md#license-and-governance) section of the spec. The reference implementation code is AGPL-3.0 (`LICENSE`). Section 6 is called **Loyal Trust Protocol (LTP)**; in earlier versions of the document it appeared as "Loyola Trust Protocol" (same acronym, same specification).

**The problem it solves**: today no complete, decentralized, free technical mechanism exists that lets an AI agent (or a human) verify whether a site is trustworthy without depending on a high-reputation domain, a central certifying authority, or circumventable proxy signals.

**How it solves it**: each site publishes its cryptographic identity (Ed25519, RFC 9421) and a public `SiteTrustScore` computed from 4 independent, auditable sources — self-declaration, AI-agent verification, community voting, and external custody reports. The whole design is crypto-agile and post-quantum-ready from the database schema up (the `key_algorithm` column allows a future migration to ML-DSA / FIPS 204 without losing the chain of custody).

**Veranet**: the end state toward which Protocol APW converges — a verifiably trustworthy network of sites, with immutable, post-quantum cryptographic identity, where no human, machine, agent, or AI can falsify the provenance of a site or its content without leaving a publicly auditable signal. Veranet is not a centralized platform: it is the state of the network when enough independent sites adopt Protocol APW and discover each other through the **Portaless Index** — a federated discovery layer with verifiable identity, pre-aggregation trust scoring, and built-in pay-for-access from the design.

**Real implementation status** (verifiable by commit, not by promise): specification v1.3 is implemented end to end in this repository — DNS-over-HTTPS resolution, `did:apw` identity with rotation, signed artifacts (JWS + JCS), DNS-anchored chained attestation history, dimension scoring, and read governance — including external witnesses (§5.7) and the Portaless Index local witness aggregator (`/.well-known/apw-index.json`). `packages/apw-resolver/` is the reference implementation; see [`ROADMAP.md`](../../ROADMAP.md) for the exact, current status of every piece.

Publication date of this specification: **September 2026**.
