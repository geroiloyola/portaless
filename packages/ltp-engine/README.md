# `@portaless/ltp-engine`

Deterministic identity-only acquisition and verification for the Local Trust
Protocol (G2/G3, authorized 2026-10-24). The package is intentionally smaller
than the protocol: it implements the reviewed `apw-identity-proof-v1` profile and
the AB-STATIC-01…07 corpus, not reputation, SVRI profiles or offline DNSSEC.

## What it does

- `acquireIdentity()` queries one operator-configured HTTPS DNS-over-HTTPS
  endpoint for `_apw.<domain>`, requires the exact TXT/IN question, `Status: 0`,
  `TC: false` and `AD: true`, then requests a complete identity-only package from
  one operator-configured Index endpoint.
- `ResourceBudget` reserves HTTP attempts and body bytes before I/O, charges
  actual bytes after the response, counts failed signature attempts and enforces
  one exclusive 10-second deadline. Limits may be lowered but never raised above
  the approved D7 ceilings.
- `verifyHandoff()` consumes the package **bytes** offline. It verifies the
  RFC 7638 thumbprint against TXT `k`, the manifest JWS, the defined key-set
  binding, full-history Ed25519 signatures, `seq`/`prev`/key windows/timestamps,
  quarantined prefix continuity, policy continuity, freshness at promotion and
  the frozen resource counters. It never performs network I/O.
- `runComposed()` wires A acquisition to B verification with the same budget, so
  signatures and elapsed time cannot reset at the handoff.

`FetchTransport` is the real HTTPS transport: it rejects redirects, plaintext,
userinfo, fragments and non-configured endpoints, streams with a hard cap and
uses the platform TLS certificate validation. Tests inject a replay transport and
never touch the network.

## Verification

```bash
node node_modules/vitest/vitest.mjs run tests/unit/ltp-engine-composed.test.ts
```

The suite executes AB-STATIC-01…07 in memory, compares every literal expected
result, checks the frozen handoff and budget counters, and rejects an inner log
signature mutation even after the attacker recomputes the outer package digest
and repairs the local prefix hashes.

## Not included

G4 reputation/SVRI mathematics, reader-conduct issuers, G5 DS-chain/NSEC/NSEC3/
wildcard/rollover validation, a custom offline DNSSEC validator, continuation or
bootstrap-segment history, issuers, deployment activation, S4 independence or S6
publication. Passing the fixtures is not a live-network, SSRF/TLS or S4 claim.
