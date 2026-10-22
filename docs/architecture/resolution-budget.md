# PR2: pre-authentication resolution budget kernel

**Status: draft implementation, inactive.** Started only after the revised
[Phase 0 ADR](../decisions/0003-public-and-governed-resource-contract.md).
This kernel is not imported by the production middleware or resolvers. It does
not activate identity fan-out, change B3, or claim that every existing APW
network call is already budgeted. Post-#97 hardening (#98) remains a prerequisite.

## Implemented kernel

`packages/trust-layer/src/net/resolution-budget.ts` supplies:

- Fixed UTC windows with bounded state; active buckets are never evicted to
  admit new attacker origins (capacity exhaustion is an explicit `503`).
- Synchronous, atomic per-process reservation of both a client bucket and the
  root directory-origin bucket **before** a network await.
- Starting configuration proposal: 20 admitted network attempts/minute and
  8 MiB body allowance/minute per client; 8 attempts and 4 MiB per root origin.
  These are kernel defaults, not enabled deployment limits. They count admitted
  network hops, not a completed identity verification or client-side retries
  that never reached the adapter.
- A byte allowance reserved up front. Successful responses refund unused
  allowance; failure/timeout retains its conservative charge. Requests are never
  refunded. Byte accounting belongs to the window in which the hop starts;
  concurrent connections still require the separate admission limit.
- Context stages for `directory`, `txt_doh`, `did`, `history`, `evidence`. They
  share the same client/root-origin allowance, so switching stage or target URL
  cannot reset quota. Root directory scope is kept across shared DoH providers.
- Hidden redirects disabled (`maxRedirects: 0`). A later adapter must resolve,
  validate, pin where supported and separately budget each redirect hop.
- Structured `429 client_budget_exhausted` and `503 origin_budget_exhausted` /
  `budget_state_full` rejections with `Retry-After` data, before fetch occurs.
- HMAC client buckets derived from trusted ingress only, UTC-day-separated and
  independent of raw IP storage. Node accepts only the runtime-injected header;
  Cloudflare requires an explicit server-controlled trusted-ingress flag.
  Missing trusted IP or secret uses a shared `unknown` bucket. Supplying a
  forged forwarded header does not select the trust mode.

## Activation blockers (must finish before identity/classification)

1. Wire the same context and accounting across every actual directory,
   TXT/DoH, DID, history and evidence resolver plus redirects, without recursion
   or double charging. Verify real adapters, not only the kernel's stage tests.
2. Select deployment limits from measurements. Verification-attempt admission,
   read/body allowance, query sizes and full-chain deadline need an explicit
   integration contract; no amount of per-identity limiting can replace this.
3. Define a shared atomic store for multi-isolate/multi-process deployments,
   failure semantics and missing backend behavior. The current kernel's Maps
   are per process; restarting/adding isolates resets their state.
4. Configure server-side secret rotation, conservative continuity during key
   changes, retention and operator diagnostics. The kernel day-separates an
   injected secret; it does not provision or rotate deployment secrets.
5. Keep streaming caps, SSRF guards and TLS hostname verification in the network
   adapter. This quota kernel is not a substitute for `createSafeFetcher`.
6. Run real whole-chain tests demonstrating that rejected unauthenticated
   clients start no egress, cold identities cannot starve unrelated configured
   origins, and no failure becomes a negative conduct attestation.

PR2 stays **draft** until these blockers are resolved. No public or governed
access-mode defaults change as a consequence of this draft.

## Tests

`tests/unit/resolution-budget.test.ts` verifies client rotation across origins,
origin rotation across clients/stages/targets, concurrent byte reservations,
failed-attempt charges, UTC expiry/Retry-After, active-state retention,
per-hop redirect accounting and trusted-ingress HMAC/unknown buckets.
