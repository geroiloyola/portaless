# Security review guide — for a second pair of eyes

This document exists so someone **other than the author** can perform the
minimal external security review that Phase 3 of
[`ROADMAP.md`](../ROADMAP.md) requires before the Beta. You do not
need to know the whole codebase: the surfaces below carry the highest damage
if they fail, and this guide maps where they live, what they promise, and how
to break them.

You do not need commit rights to review. Findings can be reported as
issues or plain messages; severity is your judgment, not a checklist. See
[`SECURITY.md`](../SECURITY.md) for the current private-reporting status.

**Refreshed 2026-10-22** to cover the Trust Layer request path (Web Bot Auth,
policy, ledger, pay-per-crawl), MCP HTTP transport, email, publication,
backup/restore and the AI provider, in addition to the Phase 14 sandbox
changes. If a row below is stale, the code is right and this guide is the
bug — say so.

## Scope (what to review)

### 1. Authentication flow

**Promise**: only the admin (or a role with `canWrite`) can change
content or trigger sensitive actions; sessions are revocable; passwords
never leave the server as plaintext; MFA step-up protects sensitive
endpoints.

Key files, in review order:

| File | What to check |
|---|---|
| `packages/auth/src/auth-service.ts` | Login, session issuance, `completePasswordReset`, TOTP enrollment/verify, OAuth login. Look for: timing-safe comparisons, single-use of challenges/tokens, session revocation on password change. |
| `functions/admin/_middleware.js` | The gate for every `/admin/*` route. Look for: routes accidentally left outside the gate, cookie flags, redirect vs. JSON behavior. |
| `functions/admin/login.js` + `functions/admin/login/mfa.js` | Login and MFA step-up endpoints. Rate limiting, error messages that leak user existence. |
| `functions/admin/api/change-password.js` | Current-password check, session revocation, audit event. |
| `functions/admin/password-reset/request.js` + `confirm.js` | Token single-use, TTL, per-IP and per-user rate limits, no user-enumeration leak. |
| `packages/auth/src/stores/*.ts` | How secrets are stored (password hashes, TOTP secrets, reset tokens). Confirm no plaintext secret is ever persisted or logged. |

Attack ideas worth trying (mentally or on a staging instance): replay a
used reset token; race two `confirm` calls with the same token; craft a
session cookie; hit a sensitive endpoint with a `viewer` session; check
whether error strings reveal whether a username exists.

### 2. Plugin sandbox

**Promise**: plugin code runs with only the capabilities it was granted;
a malicious plugin cannot escape its isolate, reach unauthorized hosts,
or call bridge capabilities it was not granted.

Key files:

| File | What to check |
|---|---|
| `packages/plugin-sandbox/src/adapters/node-isolated-vm.ts` | Self-host isolate: timeouts, memory limits, which Node APIs remain reachable. |
| `packages/plugin-sandbox/src/adapters/cloudflare-workers-for-platforms.ts` | Edge upload + invoke; the bootstrap template it generates (search `buildBootstrapCode`) — this string IS the sandbox policy for edge. |
| `packages/plugin-sandbox/src/adapters/deno-deploy.ts` | Same for Deno (`--allow-*` flags in the generated bootstrap). |
| `packages/plugin-sandbox/src/manifest/manifest-schema.ts` | What a plugin can request; confirm unknown capabilities are rejected. |
| `functions/api/internal/capability-bridge.js` | The HTTP bridge non-network capabilities go through. Token validation, capability allowlist per token, and the status mapping (`501` `NOT_CONFIGURED`, `404` `PAGE_NOT_FOUND`, `400` `INVALID_ARGS`/`STORAGE_INVALID_KEY`, `413` quotas). |
| `packages/plugin-sandbox/src/capabilities/capability-backends.ts` | **The one source of the real non-network backends** (`createCapabilityHostBridge` / `CAPABILITY_BACKENDS` / `dispatchCapability`), consumed by the HTTP bridge **and** by `runPluginInProduction()` as `hostBridge`. Check: a capability absent from `CAPABILITY_BACKENDS` answers `NOT_CONFIGURED` (`501`), never a fake success nor a false `403`; `agent:identify` exposes only the fields the public usage-log already publishes. |
| `packages/plugin-sandbox/src/registry/plugin-storage.ts` | Per-plugin storage: primary key `(plugin_id, key)`, `plugin_id` fixed by the **token**; quotas enforced server-side (64 KiB/value, 256 keys, 1 MiB/plugin) with explicit codes. |
| `infra/cloudflare/dispatcher/src/index.js` | The public dispatcher Worker: token fail-closed, script-name validation. |
| `packages/plugin-sandbox/src/runtime/production-plugin-runner.ts` | How granted ∩ requested is computed before execution, and how the `hostBridge` (the same backends as the HTTP bridge) is passed to the self-hosted adapter. |

Attack ideas: a plugin requesting `trust:read-governance-bypass`; a
bootstrap that keeps a reference to the real `fetch` (does the
best-effort host check actually run?); invoking the dispatcher URL
without the token; a `scriptName` header with path characters; replaying
a capability-bridge token after its TTL; a `pluginName` field in the body
of a `storage:*` call (must be ignored — the name comes from the token);
re-writing the same storage key to grow a plugin past its 1 MiB quota (the
accounting subtracts the previous size — verify it cannot be gamed);
`agent:identify` with `months`/`limit` out of range (must be `400`, not a
larger read); a capability that is valid in the manifest but has no real
backend (must be `501`, not `500`).

### 3. Plugin installer (added 2026-10-15 — NEW, not yet reviewed)

**Promise**: installing a plugin by HTTP never runs anything the publisher
did not sign, never grants a capability on its own, and cannot be replayed
with different bytes **or a different manifest** under the same version;
and what actually runs is the version the registry marks active, from the
stored artifact rather than from disk.

This surface did **not** exist when this guide was written. It ships behind
`PORTALESS_PLUGIN_INSTALLER`, **off by default** (404 without it), precisely
because it is unreviewed. §14.1 closed the "runtime reads code from disk"
gap (execution now resolves from `PluginArtifactStore`), so the flag is no
longer blocking on that — it stays off until this review happens.

Key files, in review order:

| File | What to check |
|---|---|
| `functions/admin/api/plugins/install.js` | Step-up enforced before anything; the signed manifest verified against the **resolved** publisher identity; install grants nothing; immutability `(publisher, name, version) → (code hash, manifest)` — reinstalling the same version with different bytes **or a different manifest** is `409`. |
| `functions/admin/api/plugins/uninstall.js` | Step-up; revokes the plugin's grants on removal. |
| `packages/apw-resolver/src/did-apw/plugin-manifest.ts` | The signature covers `requestedCapabilities`; `typ` is `apw-plugin-manifest+jws`. |
| `packages/plugin-sandbox/src/registry/plugin-artifacts.ts` | Chunked BLOB storage, hard per-artifact cap, never base64; the verified manifest travels with the artifact (`manifest_json`, self-migrated with `ALTER TABLE`); `put` rejects a manifest whose identity does not match the `(name, version)` key. |
| `packages/plugin-sandbox/src/registry/plugin-registry.ts` (+ `stores/`) | The active `version` is persisted in `manifest_json`; a row's version is what may run. |
| `functions/admin/api/plugins/run.js` | **Execution precedence**: resolves `{ manifest, code }` from `PluginArtifactStore` first, re-verifying `validateManifest(manifest)` and `sha256Hex(code) === meta.codeHash`; `409 artifact_integrity_failed` on tampered chunks, `409 artifact_manifest_missing` on a legacy artifact without a manifest, `409 artifact_version_missing` when the version the registry marks active has no stored artifact. Disk (`PORTALESS_PLUGIN_DIR`) is a fallback only when no stored artifact exists. |
| `packages/plugin-sandbox/src/install/reconcile.ts` | Removed capabilities pruned; expanded capabilities never auto-granted. |

Attack ideas: a JWS whose `publisher` is not the resolved DID; a manifest
whose `requestedCapabilities` were changed after signing (must fail); a
re-install with different code **or a different manifest** under the same
version (must be `409`); a session without step-up (must be `401`); a
stored artifact whose chunk bytes do not match its `codeHash` (must be
`409 artifact_integrity_failed`, never executed); a registry row whose
active version has no artifact (must be `409 artifact_version_missing`,
**not** a silent fall-back to the newest artifact); a `manifest_json` in
the artifact that disagrees with its own bytes or with the row's
`(name, version)`.

### 4. Trust Layer request path (added 2026-10-22)

**Promise**: a policy saved in the panel is applied to the next request;
signed agents are verified against a key directory fetched over a hardened
egress path; unsigned automated traffic is rejected; the ledger records the
decision without content or IPs. **Only `ai_input` is enforced on the request
path.** `search` and `ai_train` are published in `robots.txt`
(`Content-Signal`) and in the policy manifest; they are cooperative signals,
not request-level blocks.

Key files, in review order:

| File | What to check |
|---|---|
| `functions/_middleware.js` | Order of gates: migrations, legacy 301 (relative `Location`, base-path boundary), public discovery routes, `ENABLE_TRUST_LAYER`, signature presence, UA heuristic, `verifyWebBotAuthRequest`, policy load, ledger write. A policy `block` must answer `403`; `charge` without settlement must answer `402`; `allow` must call `next()`. |
| `packages/trust-layer/src/webbotauth/verify.ts` + `directory-fetch.ts` | `Signature-Agent` must be HTTPS and signed; single-flight, bounded caches and admission precede crypto verification. 5 s timeout and 512 KiB body cap; 6 cold-origin slots and 2 reserved slots within 8 total. The experimental resolution budget is opt-in and directory-only; it forces redirects off rather than allowing unbudgeted hops. Unavailable/cached failures map to `503 Retry-After`, or `429` for client quota, not policy misconduct. Nonce is consumed only after signature verification. |
| `packages/apw-resolver/src/federation/safe-fetch.ts` | Private IPv4/IPv6, `::ffff:` mapped forms and bracketed literals; `redirect: "manual"` and per-hop re-validation; streaming byte cap; DNS `lookup` resolves once and `fetchPinned` receives that validated address. In self-host, `server/node-runtime.mjs` pins the connection to it (Host/SNI unchanged) so a second DNS answer cannot rebind. |
| `server/node-runtime.mjs` | `createPinnedFetch()` connects to the validated address without a fresh DNS resolution. TLS certificate hostname validation and SNI remain bound to the URL hostname; `rejectUnauthorized` stays true. Binding: `env.__PORTALESS_DIRECTORY_FETCHER`. Real TLS regression: `tests/unit/pinned-fetch-tls.test.ts`. |
| `packages/trust-layer/src/policy/load-policy.ts` + `agent-access-store.ts` | Precedence store > asset > default; invalid or half-written policy never applies; the panel override is not cached. |
| `packages/trust-layer/src/policy/agent-access-store.ts` | `PUT` validation: three rules, `allow|charge|block`, positive price for `charge`; `site` is server-fixed. |
| `packages/trust-layer/src/policy/robots-generator.ts` | `search`/`ai-train`/`ai-input` become `Content-Signal`; `block` becomes `no`. |
| `packages/trust-layer/src/billing/pay-per-crawl/resolve.ts` + `activation-store.ts` | Only a verified settlement provider may charge; an unverified one must not accept a proof. |
| `packages/trust-layer/src/ledger/*` | No request body, no IP, no fabricated `charged: true`. |

Attack ideas: send `Signature-Agent: "https://169.254.169.254"` (must not
fetch); redirect the directory to loopback (must not follow); replay a nonce;
change `Signature-Agent` after signing; save `ai_input=block` and confirm the
next request is `403`; set `ai_input=charge` with no settlement and confirm
`402`; spoof `Googlebot` unsigned (rejected by the UA heuristic even with
`ai_input=allow`, see B3 below); send many invalid origins and confirm the
negative cache prevents repeated fetches.

**Admission/exhaustion (round 4):** baseline `ef9f65d` with 20 simultaneous
origins delayed 5 s consumed all 8 slots; a legitimate cold directory received
no fetch. Single-flight now permits one fetch per canonical origin (concurrent
callers share its result). At most 6 slots can be occupied by cold, unapproved
origins. The other 2 are available to origins configured locally in
`PORTALESS_WBA_RESERVED_ORIGINS` (comma-separated HTTPS origins, maximum 256).
Post-#97 review reproduced that 8 attacker-owned domains with valid signatures
could otherwise promote themselves and occupy all reserved capacity. That
automatic promotion is removed: only the owner's explicit list grants admission.
Reservation is admission eligibility, not authentication or a category grant.
Claiming that origin in `Signature-Agent` cannot grant an extra same-origin
fetch: single-flight still applies. Owner-configured reservations work with a
cold cache. The setting is documented in `.env.example` and `self-hosting.md`;
invalid/excess entries are discarded, never promoted or interpreted as wildcards.
The positive cache and 60 s negative LRU each hold at most 256 origins. LRU hits
do not extend the failure deadline. Unknown origins can still be denied during
a flood; attackers can also target known/reserved origins. These finite slots
improve isolation, not universal availability. Everything is per process/isolate.
Workers isolates share neither counters nor concurrency slots: each isolate
applies the explicit deployment list, with no learned trust from signatures.
`directory_busy` does not write the negative cache; a regression saturates the
cold lane and proves an unrelated cold origin retries immediately after release.

**Egress budget design — NOT IMPLEMENTED.** This design **replaces the earlier
global fail-closed proposal of 32 fetches/min and 16 MiB/min per process**.
A single global budget would let unrelated unauthenticated traffic starve all
legitimate readers. The implemented concurrency ceiling is only a backstop;
it is not this per-window budget. The future budget must apply before identity
verification and charge every redirect and DNS/DoH/DID/history/evidence hop:

| Budget dimension | Proposed window and action (not enabled) |
|---|---|
| Canonical directory origin, before authentication | Per-origin token bucket; starting proposal 8 cold fetch attempts/min and 4 MiB response body/min. Single-flight/cache hits do not start a second fetch. Throttle that origin with `503 Retry-After`; do not poison unrelated origins. |
| Unauthenticated client | Starting proposal 20 verification attempts/min and 8 MiB outbound response body/min per client bucket; `429 Retry-After` before starting more egress. Multiple clients cannot bypass the origin limit. |
| Verified identity | Separate post-verification request/byte bucket per verified key/identity (starting proposal 120 reads/min, byte quota chosen for the site's workload). IP rotation does not reset it. This cannot replace the two pre-authentication budgets. |

Never persist raw client IP. Derive an HMAC bucket from the runtime-trusted IP
using a server secret rotated each UTC day; retain counters for the active
window only and overlap old/new buckets conservatively across rotation. The
rotation secret must not be exposed or logged. Raw IP and raw UA are not ledger
fields. Self-host accepts only runtime-injected `x-portaless-client-ip`, derived
from the socket and explicitly trusted proxies; Cloudflare Pages accepts
`CF-Connecting-IP` only inside its trusted ingress. A directly accessible origin
must not trust an incoming Cloudflare header. Missing trusted IP/secret goes
to a bounded shared unknown-client bucket, never an unlimited exemption. These
values need workload measurements, owner approval and tests before deployment.

**TLS and Cloudflare runtime boundary:** Node uses one validated DNS answer per
redirect hop and pins that connection while checking the URL hostname's TLS
certificate. A trusted certificate for `other.example` is rejected for
`expected.example` in the real TLS test. Workers/Pages use platform `fetch`:
HTTPS/TLS hostname checks, blocked literal addresses and manual redirect-hop
validation apply, but application-controlled DNS/connection pinning is absent.
Do not claim equivalent DNS-rebinding protection there. Stronger guarantees
require a platform/network egress policy or trusted egress proxy and a real
deployment verification; this round makes no untested claim about Workers
blocking every private DNS destination.

**Egress ranges, baseline vs. round 4:** `egress-ip.ts` is the executable source.

| CIDR | Baseline `ef9f65d` | Round 4 |
|---|---|---|
| `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16` | Rejected | Rejected |
| `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24` | Missing | Rejected |
| `224.0.0.0/4`, `240.0.0.0/4` | Rejected | Rejected |
| `::/128`, `::1/128`, `fc00::/7` | Compressed forms recognized; expanded DNS forms incomplete | Rejected after numeric normalization |
| `fe80::/10` | Only textual `fe80:` recognized (not the full /10) | Entire /10 rejected |
| `ff00::/8`, `64:ff9b::/96`, `64:ff9b:1::/48`, `2002::/16`, `2001::/32` | Missing | Entire prefixes rejected, including embedded IPv4 in NAT64/6to4/Teredo |
| `::ffff:0:0/96` | Only recognized mappings to a private IPv4 rejected | Entire prefix rejected, including public embedded IPv4; no mapped-address routing ambiguity |

The denylist is not a complete registry of every special-use address. Literal
and DNS-answer regressions cover each listed prefix and boundary; invalid DNS
address strings also fail closed. Other application egress paths must opt into
this fetcher; email transports keep their separately documented network policy.
Post-#97 additions also reject `2001:db8::/32`, `192.88.99.0/24`, `100::/64`
and `fec0::/10`. Tests retain the broadcast `255.255.255.255` rejection and
exercise WHATWG normalization of decimal, hex and octal literal spellings
before the range guard (for example `2130706433`, `0x7f000001`, `0177.0.0.1`).

**Search-bot decision (B3):** `looksLikeAutomatedAgent()` matches
`bot|crawler|spider|gpt|claude|scrapy|python-requests`. An unsigned request
with such a UA is rejected with `403 unsigned_automated_request` **before the
policy is read**, so it is rejected even when `ai_input=allow`; the default
`ai_input` is `charge` with `price_usd: 0.002` and `unit: "request"`. A test
fixes this behavior and the panel banner states it when the Trust Layer is
active. User-Agent filtering only detects the bot that declares itself; a
scraper impersonating a browser bypasses this heuristic. This round only adds
measurement, not a B3 behavior model. The pending `it.skip` is tracked from
ROADMAP to the Phase 0 ADR in PR #96.

Ledger by branch: an unsigned bot-like request increments an admin-only monthly
family counter buffered in memory and flushed every 10 seconds into existing
`site_settings` (atomic batch/transaction; last 13 months) and
has no `operatorKeyId`. No raw IP, UA, URL, signature or identity is stored.
An unsigned non-bot request still writes no ledger entry. Invalid signatures write
`operatorKeyId: "unverified"` with `policyViolation: true`; a valid signature
writes the verified `operatorKeyId` for `allow`, `block` and `charge`
(`charged: false` always, because the origin does not know whether settlement
happened). Directory saturation, upstream failure and cached failures return
`503 verification_unavailable` with `Retry-After` and no ledger entry or
`policyViolation`. Expired/too-old signatures return distinct
`401 signature_expired`, also with no policy violation. They are not evidence
of misconduct. Crypto-invalid signatures remain `401 verification_failed`.
Counter availability is reported explicitly; persistence failure cannot turn
an existing rejection into an allowance. Without a DB counters are process-local.
The panel labels every count **declarada**. Before batching, N rejections
executed N UPSERTs plus N prune statements and N idempotent DDL statements.
Now N same-family rejections in an interval execute zero DB writes until the
flush, then one aggregate UPSERT and one prune (plus the idempotent DDL).
There are at most four normal current-month UPSERTs per isolate/interval, not N;
multiple isolates may each flush their own batches. The test submits 1,000
rejections and counts statements. Admin reads do not force a flush. Pending
counts are not overlaid on persisted snapshots (avoiding double counting).
Node uses an unref'd timer; Workers attaches the shared flush promise to
`waitUntil`. Restart/isolate disposal or failed flush can lose a batch; these
are declared approximate counts, not exhaustive identities or durable events.
The unknown-UA bucket exists but normally stays empty: the existing detection
heuristic does not reject requests without User-Agent. Family labels are
unverified declarations, not verified Google/Bing operator attribution.

Why `ai_input` defaults to `charge`: git blame points to the initial
implementation (`a63d5f9`/`2481951`) and there is no ADR or decision record
with a rationale. The practical contract is fail-closed: enabling
`ENABLE_TRUST_LAYER=true` without a policy file or panel override applies
`defaultContentPolicy()` — `search: allow`, `ai_input: charge` at
`price_usd: 0.002` per request, `ai_train: block`. With no verified settlement
provider, a signed agent gets `402 payment_required` with
`settlement: "not_available"` and cannot read; unsigned bot-like traffic gets
`403` before policy loading; unsigned browser traffic passes.

### 5. MCP server (HTTP and stdio)

**Promise**: every HTTP invocation carries its own agent identity; tools
enforce capabilities per call; a token cannot escalate itself; the endpoint is
bound to an explicit host/origin and bounded in size, concurrency and rate.

Key files:

| File | What to check |
|---|---|
| `packages/mcp-server/src/http.ts` | Host allowlist (required off loopback), exact Origin allowlist, per-IP rate limit, concurrency cap, body cap, POST-only, bearer required before JSON-RPC. |
| `packages/mcp-server/src/permissions/agent-token-store.ts` | Tokens stored as SHA-256 only; issue returns plaintext once; rotation revokes the previous token; no hash/plaintext in `list()`. |
| `packages/mcp-server/src/permissions/agent-identity.ts` | HTTP resolver verifies the bearer on every call. Stdio uses the fixed per-process env identity (documented gap). |
| `packages/mcp-server/src/tools/grant-capability.ts` + `revoke-permission.ts` | `site:admin` can grant to other subjects, including the caller; this is the highest-friction tool and must remain explicitly reviewed. |
| `packages/mcp-server/src/tools/*.ts` | Every data-touching tool calls `requireCapability()` before reading or writing. |

Attack ideas: call without `Authorization`; reuse a revoked token; send a
`Host`/`Origin` not in the allowlist; exceed body/concurrency/rate limits;
grant yourself `site:admin` without a grant; call a private-context tool
without `mcp:private-context:read`.

### 6. Email (auth and plugin `email:send`)

**Promise**: a plugin never chooses `from`, cannot inject headers via CR/LF,
cannot exceed its daily quota, and a failed delivery is not reported as
success.

Key files:

| File | What to check |
|---|---|
| `packages/plugin-sandbox/src/capabilities/capability-backends.ts` | Blind delegation contract (`{ template, to, data }`), template allowlist, per-plugin quota, explicit `EMAIL_*` errors. |
| `packages/email-transport/src/config.ts` | Webhook URL normalization (public HTTPS), template rendering strips CR/LF from plugin data. |
| `packages/email-transport/src/send.ts` | Webhook redirects disabled; 5xx is `unknown`, not success; SMTP STARTTLS mandatory with credentials; dot-stuffing; reply/body size caps. |
| `packages/auth/src/email-sender.ts` + `functions/admin/password-reset/*` | Reset tokens single-use, TTL-bounded, generic response to avoid user enumeration. |

Attack ideas: plugin sets `from` or injects `\r\nBcc:`; webhook redirects to
an internal host; SMTP server advertises no STARTTLS but credentials are set;
replay a reset token; exceed the plugin daily quota concurrently.

### 7. Publication and backup/restore

**Promise**: only an approved snapshot is published; a stale snapshot is
refused; unpublish leaves a tombstone; backups are checksummed, exclude
secrets by default, and restore requires stopping the active writer.

Key files:

| File | What to check |
|---|---|
| `functions/admin/api/publication.js` | Admin-only; actions `publish|retry|unpublish`; Cloudflare answers `build_runtime_unavailable`; preview proxy cannot be used as a public route. |
| `packages/deploy-engine/src/publication-orchestrator.ts` + `publication-snapshot.ts` | Snapshot hash/revision IDs, idempotence, stale retry refusal, tombstone. |
| `scripts/publish-site.mjs` | Re-checks the snapshot before and after the build; only approved revisions reach the stage. |
| `packages/portability/src/index.ts` | Manifest format/version, database checksum, secrets excluded unless explicit CLI flag, restore verifies checksum and single-writer activation. |
| `functions/admin/api/backup.js` | Node-only; admin-only; `includeSecrets` rejected from the endpoint; manifest is public-safe. |

Attack ideas: publish while a revision is being approved; retry an old run;
unpublish then fetch the old route; tamper with a backup chunk; restore while
the writer is active; request `includeSecrets` through HTTP.

### 8. OpenAI-compatible provider

**Promise**: the API key stays server-side; only HTTPS endpoints are accepted;
timeouts/cancellation are bounded; provider errors are sanitized.

Key files:

| File | What to check |
|---|---|
| `packages/ai-provider/src/index.ts` | Base URL validation, key never in profile, timeout bounds, error mapping, streaming parser bounds. |
| `functions/admin/api/ai-provider.js` | Admin-only status; never returns the key. |
| `tests/unit/ai-provider-openai-compatible.test.ts` | Contract suite; external endpoints are `not_run` until a real key/endpoint/model is recorded. |

Attack ideas: point the base URL at `http://` or an internal host; ask the
status endpoint for the key; send a stream that never ends; return a huge
tool-call payload; make the provider echo the key in an error.

## How to run the tests (no cloud accounts needed)

```bash
npm install
node node_modules/vitest/vitest.mjs run
```

The suites most relevant to this review:

- `tests/unit/auth-*.test.ts`, `tests/unit/admin-login-endpoints.test.ts`,
  `tests/unit/password-reset-*.test.ts` — auth flow.
- `tests/unit/sandbox-*.test.ts`, `tests/e2e/sandbox-*.test.ts`,
  `tests/unit/capability-*.test.ts` — sandbox + bridge.
- `tests/unit/webbotauth-*.test.ts`, `tests/unit/trust-layer-middleware.test.ts`,
  `tests/unit/agent-access-policy.test.ts` — Web Bot Auth, policy and ledger.
- `tests/unit/mcp-*.test.ts`, `tests/unit/mcp-server-sdk-integration.test.ts` —
  MCP identity, tools and HTTP transport.
- `tests/unit/admin-publication-endpoint.test.ts`,
  `tests/unit/publication-orchestrator.test.ts`,
  `tests/unit/admin-backup-endpoint.test.ts`,
  `tests/unit/portability-backup.test.ts` — publication and backup/restore.
- `tests/unit/ai-provider-openai-compatible.test.ts` — provider contract.
- `tests/browser/*.spec.ts` — real browser flows against the self-host
  runtime (`npx playwright test`).

Real-API verification of the edge adapters (needs your own credentials):

```bash
node node_modules/tsx/dist/cli.mjs scripts/verify-sandbox-adapters.ts
```

## What "done" looks like for this review

There is no formal certification. The Phase 3 exit criterion is satisfied
when **someone other than the author** has read the surfaces above,
run (or clearly reasoned through) at least the attack ideas, and stated
in writing: "I reviewed X and Y; findings are Z (or: no findings at
this depth)." Depth is your honest call; a 90-minute focused pass that
surfaces one real issue is worth more than a week of skimming.
