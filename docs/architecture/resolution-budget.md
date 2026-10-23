# First line of defense: edge proxy/WAF — resolution budgets (PR2)

**Recommendation pending owner confirmation:** enforce admission/rate/connection
limits at a trusted edge proxy/WAF first. The kernel is a bounded local backstop,
not fleet-wide DoS protection. Without a trusted client IP there is **no
per-client limit**: all such requests share `unknown`, and one caller can deny
other unknown callers. With **N live instances**, retained per-instance quota
can allow up to **N times** the configured allowance per window. Restarts,
bucket eviction and HMAC identity changes can further reset consumption;
there is no strict aggregate request-rate guarantee in this profile.

**Status: draft implementation, opt-in and disabled by default.** Started only after the revised
[Phase 0 ADR](../decisions/0003-public-and-governed-resource-contract.md).
The middleware can pass this kernel to the real Web Bot Auth directory adapter
only when `PORTALESS_RESOLUTION_BUDGET_ENABLED=true`; absent that explicit flag,
the existing request path is unchanged. It does not activate identity fan-out,
change B3, or claim that every existing APW network call is already budgeted.
Post-#97 hardening (#98) is merged, but whole-chain budgets remain incomplete.

## Implemented kernel

`packages/trust-layer/src/net/resolution-budget.ts` supplies:

- Fixed elapsed-time windows with bounded state. Buckets with live permits are
  never evicted; exhausted or byte-denied buckets are also protected until
  their window expires. When capacity is full, eligible idle buckets with the fewest attempts
  are evicted first (bytes break ties; insertion order breaks remaining ties).
  Current-request keys are protected, so retrying an exhausted key does not
  itself clear its consumption. If insufficient idle entries exist, reject
  with `503 budget_state_full` without partial eviction. A bounded indexed
  min-heap maintains eligibility/priority in O(log n) per update/pop; admission
  no longer scans or sorts the table. At rollover the whole-window map/index
  are replaced; late completions cannot reinsert old entries. Protected
  consumption may fill the table and deny a new legitimate key until expiry.
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
- `performance.now()` supplies monotonic time for quota windows and directory
  cache expiry. Forward/backwards wall-clock jumps cannot expire them. Wall
  time is used only for the HMAC UTC day (and protocol signature timestamps),
  not quota/cache expiry. HMAC day changes can create a new client identity;
  they do not establish a globally continuous quota.
- HMAC client buckets derived from trusted ingress only, UTC-day-separated and
  independent of raw IP storage. Node accepts only the runtime-injected header;
  Cloudflare requires an explicit server-controlled trusted-ingress flag.
  Missing trusted IP or secret uses a shared `unknown` bucket. Supplying a
  forged forwarded header does not select the trust mode.

## Pending owner decision: per-instance vs. shared atomic counters

The recommended initial profile is edge controls plus approximate per-instance
counters; the owner has not confirmed it. The in-memory implementation is a
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
- The regression sends 10,000 distinct completed one-use clients/origins and
  then a new legitimate client in the same window. Before eviction, only 2,048
  client/origin pairs fitted in 4,096 entries and the legitimate client received
  `503`. With idle least-use eviction all 10,001 fetches are admitted and the
  table stays at or below 4,096 entries. This deliberately favors new admission;
  an evicted caller can regain quota, so it must not be sold as strict rate
  enforcement. Active-origin accounting also survives out-of-order completion.
- A separate adversarial test exhausts a client, then sends uniform filler
  traffic. The prior LFU eviction forgot the exhausted client and admitted it
  again. Exhausted scopes now remain pinned until expiry (including a scope
  rejected for insufficient byte allowance), so filler cannot erase that deny.
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
3. Obtain the owner's confirmation of edge controls plus approximate local
   counters, or implement/test shared atomic counters if a fleet-wide guarantee
   is required. The current Maps are per process; no silent shared-to-local
   fallback is permitted.
4. Configure server-side secret rotation, conservative continuity during key
   changes, retention and operator diagnostics. The kernel day-separates an
   injected secret; it does not provision or rotate deployment secrets.
5. Keep streaming caps, SSRF guards and TLS hostname verification in the network
   adapter. This quota kernel is not a substitute for `createSafeFetcher`.
6. Run real whole-chain tests demonstrating that rejected unauthenticated
   clients start no egress, cold identities cannot starve unrelated configured
   origins, and no failure becomes a negative conduct attestation.

The merged PR2 increments do not close these blockers. No public or governed
access-mode defaults change as a consequence of this draft.

## Directory redirects: explicit failure

With the opt-in budget enabled, `maxRedirects: 0` means any directory redirect
fails: the target is not fetched. The adapter and verifier return
`directory_redirect_disabled`; the middleware responds **401**, without
`Retry-After`. This is not cached as upstream unavailability (the negative
cache stays empty) and is not a conduct violation. The reason is a local
request diagnostic, **not a durable audit entry**; it contains neither URL
credentials nor secrets. Repeated attempts consume the existing budget.
Operators must serve the directory
at its canonical URL until separately budgeted redirects are implemented.

## Workers clocks and HMAC-day resets

According to [Cloudflare's Performance and timers documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/)
(consulted 2026-10-22), deployed Workers advance `performance.now()` and
`Date.now()` only after I/O; CPU-only loops can measure zero elapsed time.
`performance.timeOrigin` is 0 there. Local workerd timers advance independently
of I/O. Do not extrapolate the Node CPU benchmark below to a deployed Worker,
use it to measure Worker CPU work, or treat the elapsed clock as a hard
preemption/deadline mechanism. This code does not fall back to Date for expiry;
runtime deployments and timers still require platform-specific acceptance.

The UTC day is included in **every known client's HMAC input**. A new day
therefore causes a global logical reset of those client identities/allowances,
including a forward wall-clock jump across midnight. Both current/previous
secret aliases change together: two-key overlap does not bridge a day change.
This is not a physical clearing of all quota state: **origin quotas, active
leases and `unknown` do not reset merely because the HMAC day changes**. The
high-water day never decreases after a backwards wall-clock jump, so the
future day persists until wall time catches up. A restart loses that high-water
state too. Edge limits must cover these discontinuities.

## Minimum operator edge rule (recommended, awaiting owner confirmation)

Before enabling the experimental profile, configure and verify an equivalent
rule in the chosen proxy/WAF for requests that can initiate remote resolution
(currently the signed-agent path, including requests with forged signatures):

- Use the connection's source address or an authenticated trusted-proxy chain,
  not arbitrary client-supplied forwarding headers. Prevent direct-origin access
  around the proxy and overwrite/strip spoofable internal IP headers.
- Starting **operator rule proposal**: at most 20 such requests per trusted
  source per 60 seconds (burst at most 20), at most 4 concurrent per source and
  8 concurrent to the resolver-facing origin pool; reject overflow before the
  application starts egress. These proposed values require workload measurement.
- Bound incoming headers/body before expensive parsing (starting proposals:
  16 KiB total headers and 16 KiB request body for this resolution-facing path).
  Check aggregate traffic too: rotating addresses can evade a source-IP rule.
- If the edge cannot establish a trusted client address, use a bounded shared
  lane or reject that resolution path; never invent per-client attribution.
  Test direct-origin bypass, spoofed headers, overflow and restart behavior
  with controlled traffic. Record the actual operator rule and measurements.

This is a required deployment configuration recommendation, **not automatically
installed by Portaless**. No capability, quota, plan, price or compatibility
of a third-party proxy/WAF is asserted. `/admin/agents` reports ingress
configuration from server context only: Node runtime, operator-declared trusted
Cloudflare ingress, or unconfigured. It always states edge rules are unverified;
a flag/indicator is not evidence that these rules or origin isolation exist.

## Sustained full-table admission measurement

Reproduce with `node --import tsx scripts/measure-resolution-admission.mjs`.
Node v24.12.0 on this local macOS host; synthetic resolved fetcher, no network.
Fill each table, warm with 2,000 more churn admissions, then time 6,000 new
client/origin pairs while the table stays full. Milliseconds per admission:

| Entries | Before p50 / p95 / p99 | Indexed p50 / p95 / p99 |
|---|---|---|
| 128 | 0.017666 / 0.092291 / 0.347458 | 0.004583 / 0.007625 / 0.027959 |
| 1,024 | 0.099125 / 0.463291 / 0.975333 | 0.005417 / 0.009000 / 0.040041 |
| 4,096 | 0.455083 / 1.702875 / 3.291166 | 0.006250 / 0.012583 / 0.044333 |

The old implementation scaled with a full scan and sort on each cold admission;
the indexed version has no linear scan on that path. Each measured run ended
with its configured table capacity and zero active leases. Numbers are local
observations, not deployment latency or a guarantee against CPU/egress DoS.

## HMAC rotation procedure (local approximate profile)

`.env.example` contains only blank secret values; never deploy an example or
public key as a secret. Keep a cryptographically random value with at least
32 random bytes in server-side secret storage, never in the config API, Git,
logs or tickets. `openssl rand -base64 32` can generate one locally; transfer
it directly into protected secret storage without logging it in deployment jobs.

1. Keep the old current secret. Provision the new secret as the previous-slot
   value first, so all instances charge both old and new HMAC aliases. Wait
   until all instances use this overlap configuration.
2. Swap: set `PORTALESS_RESOLUTION_BUDGET_SECRET` to the new value and
   `PORTALESS_RESOLUTION_BUDGET_PREVIOUS_SECRET` to the old value. Both aliases
   remain charged together; swapping order cannot create extra consumption.
3. Retain overlap for at least the longest configured quota window **after the
   last instance update** (and any outstanding request deadline). Verify the
   deployment is converged, then remove the previous value. Do not rotate again
   until that process finishes; only two keys are supported.
4. Remove the retired key from secret storage according to the operator's
   retention policy. Never print either key in diagnostics. Enabled deployments
   with a missing/short key fail with a generic `503` before directory egress;
   disabled deployments do not require a key.

There is no automatic expiry/provisioning of the previous key. Process restart
resets counters even if both secrets are retained. This procedure preserves
overlap only within live local state; edge controls must cover restarts and
multi-instance allowance. Persisted limits remain `effective: false` until
runtime integration is completed.

## Tests

`tests/unit/resolution-budget.test.ts` verifies client rotation across origins,
origin rotation across clients/stages/targets, concurrency-permit release on
success/timeout/abort/exception, failed-attempt charges, bounded state and
window cleanup, wall-clock jumps, unknown-bucket isolation, elapsed expiry and
Retry-After, per-hop redirect accounting and trusted-ingress HMAC buckets.
`tests/unit/directory-admission.test.ts` also verifies the real directory
adapter charges before egress and does not negative-cache budget exhaustion.
