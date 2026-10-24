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

`FetchTransport` is the real HTTPS transport. Before any socket it rejects
plaintext, credentials, fragments, configured query injection, IP-literal
subjects and special-use hostnames/CIDRs (loopback, private, link-local, CGNAT,
multicast, documentation, metadata, mapped/NAT64/6to4, ULA). It resolves all DNS
answers once, rejects the whole name if any answer is blocked, and pins the
verified address in the socket lookup to prevent rebinding. It never follows
redirects, keeps TLS certificate validation on, caps the streamed body and aborts
a hanging connect at the shared deadline.

The socket regression binds a real loopback listener and proves the connector
opens **zero connections** to it; a separate test starts a local TLS server with
a self-signed certificate and verifies the real connector rejects it. Replay
tests still never touch the network.

## Verification

```bash
node node_modules/vitest/vitest.mjs run tests/unit/ltp-engine-composed.test.ts
```

The suite executes AB-STATIC-01…07 in memory, compares every literal expected
result, checks the frozen handoff and budget counters, and rejects an inner log
signature mutation even after the attacker recomputes the outer package digest
and repairs the local prefix hashes. `ltp-engine-ssrf.test.ts` covers hostile
destinations, DNS rebinding, redirects, TLS rejection, byte caps, hanging
connects and attempt/signature/deadline exhaustion.

## Not included

G4 reputation/SVRI mathematics, reader-conduct issuers, G5 DS-chain/NSEC/NSEC3/
wildcard/rollover validation, a custom offline DNSSEC validator, continuation or
bootstrap-segment history, issuers, deployment activation, S4 independence or S6
publication. Passing the fixtures is not a live-network, SSRF/TLS or S4 claim.
