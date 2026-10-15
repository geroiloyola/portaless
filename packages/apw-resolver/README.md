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

## Standalone client (does not require the rest of Portaless)

The `.` export (`src/standalone.ts`) is the **minimal verifier surface** for external projects: resolve a `did:apw` identity, fetch and verify the site manifest (DNS TXT), verify the chained history, and verify site JWS signatures (JCS RFC 8785 + Ed25519). Its dependency graph touches **no other Portaless package, no database, no Node built-ins** — only Web APIs (`fetch`, `crypto.subtle`) and [`canonicalize`](https://www.npmjs.com/package/canonicalize) (JCS).

```bash
npm install @portaless/apw-resolver
```

```ts
import { resolveApwIdentity, resolveApwHistory, verifySiteJws } from "@portaless/apw-resolver";

const identity = await resolveApwIdentity("example.com");
if (!identity.resolved) throw new Error(`APW: ${identity.reason}`);
// identity.didDocument, identity.manifest

const history = await resolveApwHistory("example.com");
if (!history.verified) throw new Error(`APW history: ${history.reason}`);
```

Conformance target: the minimal vectors of [`APW-VECTORS-v1.3.md`](../../docs/protocol-apw/APW-VECTORS-v1.3.md) — **V-01, V-03, V-05, V-06, V-08, V-09** — with the normative spec at [`APW-SPEC-v1.3.md`](../../docs/protocol-apw/APW-SPEC-v1.3.md). New implementers should start at [`docs/protocol-apw/STARTER-KIT.md`](../../docs/protocol-apw/STARTER-KIT.md) (language-agnostic guide with pseudocode); this package is the TypeScript reference, not a prerequisite for implementing the protocol.

The `./full` export (`src/index.ts`) adds the DNSLink helpers on top of the standalone surface. Trust scoring, reader conduct, and the server-side identity store are **not** part of the published client surface — they belong to the Portaless server, not to an external verifier.

## Building and publishing (maintainers)

```bash
npm run build          # tsc (d.ts) + esbuild (ESM bundle) -> dist/
npm publish            # prepublishOnly rebuilds; requires npm login
```

The package is prepared for independent publication (version, `files`, `exports`, sole runtime dependency `canonicalize`); the publish itself is an operator step with npm credentials. Note: `dist/` is gitignored — publish from a clean `npm run build`.

## Conformance (Phase 7)

This package ships an executable conformance suite that verifies an implementation
against the official test vectors of `APW-SPEC-v1.3`. A third-party
implementer can verify compatibility without reading Portaless's source code by
running the published runner against the spec's vectors.

**To run the suite against this reference implementation:**
```sh
npm run conformance   # uses ../../docs/protocol-apw/vectors/v1.3/
```

**To run the suite against YOUR implementation:**
1. Download the test vectors from the specification repository (`docs/protocol-apw/vectors/v1.3/`).
2. Run the `apw-conformance` binary against that directory.
```sh
npx @portaless/apw-resolver@latest <path-to-your-vectors-dir>
```

The suite exits with code 0 if every executed case passes, 1 otherwise. Vectors
with no executor for their `kind` are reported as `unsupported` and also fail,
because an unexecuted vector is not a passing vector.

## License

Implementation code: AGPL-3.0. The APW specification itself: CC BY 4.0 (reimplementation does not create AGPL obligations) — see "Licencia y gobernanza" in the spec.
