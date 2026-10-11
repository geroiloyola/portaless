# @portaless/apw-resolver

Reference implementation of **Protocol APW v1.3** (Air Portal Website) — an open protocol for cryptographic identity and verifiable trust on independent websites.

Normative specification: [`docs/protocol-apw/APW-SPEC-v1.3.md`](../../docs/protocol-apw/APW-SPEC-v1.3.md) (CC BY 4.0). Test vectors: [`APW-VECTORS-v1.3.md`](../../docs/protocol-apw/APW-VECTORS-v1.3.md). Implementation status: see [`ROADMAP.md`](../../ROADMAP.md) and [`AGENT.md`](../../AGENT.md).

## What this package implements

- **DNS resolution** (`src/dns-txt/`): DNS-over-HTTPS lookup of the `_apw.<domain>` TXT record (v1 with `k`, v2 with `k` + `h`).
- **DNSLink** (`src/dnslink/`): immutable content pointers; `dnslink/cli.mjs` computes and anchors the TXT.
- **`did:apw` identity** (`src/did-apw/`): key history with rotation, site manifest (v1/v2), JWS + JCS signing, chained attestation log anchored in DNS, external witnesses (spec §5.7), and the Portaless Index local witness aggregator (`witness-index.ts`, published at `/.well-known/apw-index.json`).
- **Reader conduct & scoring** (`src/scoring/`, `src/reader-conduct/`): dimension scoring (Annex A) and fail-closed reader-reputation policies (section 6, Loyal Trust Protocol).

## HTTP surfaces (served by the site, not by this package directly)

Public: `/.well-known/did.json`, `/.well-known/apw-log.json`, `/.well-known/apw-witnesses.json`, `/.well-known/apw-manifest.jws`, `/.well-known/apw-index.json`, `/.well-known/apw-attestations.json`. Integrator guide: [`docs/api/`](../../docs/api/).

## License

Implementation code: AGPL-3.0. The APW specification itself: CC BY 4.0 (reimplementation does not create AGPL obligations) — see "Licencia y gobernanza" in the spec.
