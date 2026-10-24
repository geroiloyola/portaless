# G2/G3 implementation scope — identity-only acquisition and verification

**Status: authorized by the owner on 2026-10-24; implementation in this PR;
not a release, deployment activation or S4 claim. License: CC BY 4.0.**
Basis: [canonical gates register](./LTP-GATES-AND-AUTHORIZATIONS.md), G1 decision
at corpus `wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA`, revised from `main`
`7fd939fda0e2570e5c18dfbe0e555483b52b449f`.

This document names the authorized work so it cannot be confused with the
blocked scopes. The owner decision is authoritative; this file records its
boundaries and acceptance evidence.

## G2 — acquisition, network and budgets (authorized, bounded)

Permitted:

- Configured HTTPS DNS-over-HTTPS TXT acquisition for `_apw.<domain>`, using
  only the operator-selected endpoint and resolver identifier.
- Configured HTTPS Index package acquisition with the exact subject,
  request ID, profile, bootstrap profile and bounded request limits.
- A single shared operation budget and exclusive deadline across acquisition and
  verification. HTTP attempts, response bytes, DoH bytes, package bytes and
  signature attempts are counted; failed attempts are not refunded.
- Rejection of redirects, plaintext transport, userinfo/fragments, unconfigured
  endpoints, truncated/ambiguous DNS answers, AD=false, oversized bodies and
  deadline exhaustion.
- An injectable transport boundary so tests replay frozen fixture bytes without
  network access.

Not permitted by G2: redirect following, unsigned DNS fallback, more permissive
resolver selection, unconfigured origins, cross-instance quota claims, new
deployment defaults, production activation or changes to the existing edge
budget settings.

## G3 — deterministic verification engine (authorized, bounded)

Permitted:

- Offline verification of a supplied `ltp-proof-package` for
  `apw-identity-proof-v1`, consuming the package bytes rather than trusting the
  Index envelope.
- APW identity checks: DID document/key, TXT `k` thumbprint, manifest JWS,
  site/trust fields, stable target digest and key-set binding.
- Full-history checks: key windows, EdDSA signatures, consecutive `seq`, `prev`,
  timestamp regression, terminal hash, quarantined prefix continuity, policy
  continuity, one shared deadline, promotion freshness and explicit
  no-grant/no-reputation/no-implementation fields.
- The exact AB-STATIC-01…07 outcomes and adversarial tamper regressions.

Not permitted by G3: reputation/SVRI profile mathematics (G4), reader-conduct
issuers or calibration (G4), DS-chain/NSEC/NSEC3/wildcard/rollover or a custom
offline DNSSEC validator (G5), independent-verifier claims (S4), normative
release (S6) or runtime conformance beyond the supplied identity-only profile.

## Acceptance for this increment

- `tests/unit/ltp-engine-composed.test.ts` executes A→B in memory and matches all
  seven literal expected objects, the frozen master handoff and budget counters.
- A mutated inner log signature is rejected even after the attacker recomputes
  the outer package digest and repairs local prefix hashes.
- Budget, deadline, canonical-bytes and primitive tests fail closed.
- The full repository test/build/browser suite remains green.
- Passing these tests is not S4 independence, G4/G5 coverage, a release or a
  deployment activation.

## Known limits

- Node `crypto` provides the Ed25519 primitives; this is not an independent
  language/backend verifier. S4 remains open.
- The real transport relies on the platform's HTTPS certificate validation. A
  separate DNS/TLS/SSRF acceptance review and measurements are still required
  before production activation.
- The static harness replays frozen transcripts; it does not prove live resolver
  behavior, global quota enforcement or deployed latency.
- Only the identity-only profile and full history fit this increment. Continuation,
  bootstrap segments, issuers and reputation remain out of scope.
