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

## 2026-10-24 hardening addendum — live egress and SSRF

The owner authorized a second bounded G2 increment to harden the real connector:

- Reject plaintext, credentials, fragments, pre-existing endpoint queries, IP-literal
  subjects and special-use hostnames before DNS or socket work.
- Reject every special-use/local IPv4 and IPv6 range, including mapped, NAT64,
  6to4, multicast, link-local, documentation and metadata addresses.
- Resolve all DNS answers once; reject the whole name if any answer is blocked;
  pin the verified address in the socket lookup so a later answer cannot redirect
  the connection (rebinding).
- Keep TLS certificate validation on, never follow redirects, enforce a streamed
  byte cap, and abort a hanging connect at the shared deadline.
- Prove fail-closed behavior for latency, malformed bodies, attempt/byte/signature
  exhaustion and clock jumps.

Still not authorized by this addendum: production activation, external live
traffic in CI, shared cross-instance quotas, G4/G5, reputation/SVRI profiles or
offline DNSSEC. The local socket test proves zero connections to a listening
loopback server; it does not replace a deployment TLS/SSRF review.

## Runtime coverage: Node only, not Cloudflare Workers

`FetchTransport` is a **Node-only** adapter. It uses `node:https` and
`node:dns/promises` to resolve once, reject blocked answers and pin the verified
address in the socket `lookup`. Cloudflare Workers expose `fetch` without a
DNS-lookup/pinned-connect hook, so **the Workers engine path is not covered by
this implementation and remains blocked**. No Workers adapter is implemented,
tested or authorized here. A future adapter needs a platform-supported pinned
IP/connect primitive (or a trusted egress proxy with equivalent guarantees) and
its own SSRF/rebinding/TLS tests before it can claim parity. The edge middleware
`functions/_middleware.js` does not import `packages/ltp-engine`; identity-engine
runtime integration is a separate proposal, not part of this PR.

## Controlled DoH smoke test — requires operator consent

A real DoH smoke test is **not executed in CI** and is not authorized by this
document alone. Before any activation, a controlled test requires:

- Written consent from the operator who owns the configured resolver and test
  domain; no third-party resolver, domain or customer is used.
- One operator-owned test name and an explicit TTL; only the exact TXT/IN query
  is sent. No fan-out, crawling, retries against third parties or load testing.
- A recorded endpoint identifier, resolver identifier, start/end time, request
  count (one), response hash, TLS verification result and budget counters.
- A pre-agreed stop condition and rollback: any mismatch, timeout, unexpected
  answer, certificate error or budget exhaustion ends the test; it does not
  trigger fallback.
- Results stored as acceptance evidence with the operator, endpoint revision and
  configuration; no production traffic is enabled by the smoke test.
- A separate review of the deployment egress policy (proxy/firewall, DNS
  resolver, certificate store) because the Node pinning test does not audit the
  hosting environment.

Until those conditions and a recorded owner activation decision exist, the
engine remains a tested library, not a live service. Runtime configuration,
per-DID categories/grants, diagnostics and B3 enforcement are only proposed in
[the runtime integration proposal](../architecture/ltp-runtime-integration-proposal.md);
they are not implemented here.

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
