# PR2: pre-authentication resolution budget kernel

**Status: draft implementation, opt-in and disabled by default.** Started only after the revised
[Phase 0 ADR](../decisions/0003-public-and-governed-resource-contract.md).
The middleware can pass this kernel to the real Web Bot Auth directory adapter
only when `PORTALESS_RESOLUTION_BUDGET_ENABLED=true`; absent that explicit flag,
the existing request path is unchanged. It does not activate identity fan-out,
change B3, or claim that every existing APW network call is already budgeted.
Post-#97 hardening (#98) is merged, but whole-chain budgets remain incomplete.

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
  active operations have separate global, per-client and per-origin limits.
  Active permits release in `finally` on success, timeout result, abort and
  exception; consumed attempt/byte charges are not refunded on failure.
- Context stages for `directory`, `txt_doh`, `did`, `history`, `evidence`. They
  share the same client/root-origin allowance, so switching stage or target URL
  cannot reset quota. Root directory scope is kept across shared DoH providers.
- Hidden redirects disabled (`maxRedirects: 0`). A later adapter must resolve,
  validate, pin where supported and separately budget each redirect hop.
- Structured `429 client_budget_exhausted` and `503 origin_budget_exhausted` /
  `budget_state_full` rejections with `Retry-After` data, before fetch occurs.
- A monotonic logical clock prevents a backwards wall-clock adjustment from
  reopening a previously consumed window. Quota state is bounded by
  `maxBuckets`; expired buckets are swept on the next admission, and same-window
  active quota entries are not evicted to make room.
- HMAC client buckets derived from trusted ingress only, UTC-day-separated and
  independent of raw IP storage. Node accepts only the runtime-injected header;
  Cloudflare requires an explicit server-controlled trusted-ingress flag.
  Missing trusted IP or secret uses a shared `unknown` bucket. Supplying a
  forged forwarded header does not select the trust mode.

## Pending owner decision: per-instance vs. shared atomic counters

No deployment guarantee has been selected. The in-memory implementation is a
per-process/isolate approximation; the proposed limits are not globally
enforced. The owner must choose the required profile before production
activation:

| Backend | Guarantee | Latency and cost | Trade-off |
|---|---|---|---|
| Process/isolate memory | Synchronous atomic reservation within one live instance. | No storage round trip or storage write cost; local CPU and bounded memory. | New isolates/processes and restarts have independent/fresh budgets. No fleet-wide limit or persistence. |
| D1 with conditional transactional reservation | Shared accounting is possible only if client and root-origin reservations are atomic together, including expiry/rotation semantics. | Adds database round trips, write cost and contention; latency/cost must be measured in deployment. | Separate updates that can partially succeed are not an acceptable implementation. |
| Durable Objects | Serialized updates within a coordinator object/partition. | Adds object invocation and storage costs/latency; must be measured. | Independent client and origin coordinators do not make a two-key reservation atomic by themselves; sharding and failure semantics need design. |

Recommendation for implementation: expose a typed backend contract and declare
its guarantee in diagnostics. Never silently fall back from a required shared
backend to process-local counters. Until the owner decides and the selected
backend is implemented/tested, this kernel does not claim cross-instance
protection.

## Review hypotheses checked in the kernel

- Active concurrency is distinct from consumed attempt/byte quota. The permit
  returns to zero on all completion paths; failed attempts retain their charge.
- `maxBuckets` bounds memory under arbitrary client/origin churn. Old windows
  are swept lazily on admission; an idle instance can retain at most the
  configured maximum until another request or process exit.
- Requests without trusted IP/secret share `unknown`. Its exhaustion denies
  further unknown-bucket egress but does not consume a valid HMAC client's
  client quota. Unknown clients can still cause denial for one another; no
  unauthenticated identifier can provide per-caller fairness.
- `Retry-After` contains only the public error class/status and a positive
  duration, not bucket IDs, remaining allowance, raw addresses or backend state.
- The kernel supports overlapping current/previous HMAC keys: both aliases are
  reserved together so requests seen before and during rotation share the old
  quota. The verifier requires a >=32-character current secret when this
  opt-in integration is enabled, and rejects an invalid previous secret.
  Provisioning, secure rotation/retention procedures and cross-instance atomic
  reservations remain deployment blockers.

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
origin rotation across clients/stages/targets, concurrency-permit release on
success/timeout/abort/exception, failed-attempt charges, bounded state and
window cleanup, clock rollback, unknown-bucket isolation, UTC expiry and
Retry-After, per-hop redirect accounting and trusted-ingress HMAC buckets.
`tests/unit/directory-admission.test.ts` also verifies the real directory
adapter charges before egress and does not negative-cache budget exhaustion.
