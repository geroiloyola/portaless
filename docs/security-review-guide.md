# Security review guide — for a second pair of eyes

This document exists so someone **other than the author** can perform the
minimal external security review that Phase 3 of
[`ROADMAP.md`](../ROADMAP.md) requires before the public Beta. You do not
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
| `packages/trust-layer/src/webbotauth/verify.ts` | `Signature-Agent` must be HTTPS and signed; directory fetch goes through `createSafeFetcher` (HTTPS only, private/literal targets blocked, per-hop redirect validation, 5 s timeout, 512 KiB cap, 2 redirects); nonce is consumed only after the signature verifies. |
| `packages/apw-resolver/src/federation/safe-fetch.ts` | Private IPv4/IPv6, `::ffff:` mapped forms and bracketed literals; `redirect: "manual"` and per-hop re-validation; streaming byte cap; DNS `lookup` hook. Without `lookup`, DNS rebinding remains the documented residual risk (ADR 0002). |
| `packages/trust-layer/src/policy/load-policy.ts` + `agent-access-store.ts` | Precedence store > asset > default; invalid or half-written policy never applies; the panel override is not cached. |
| `packages/trust-layer/src/policy/agent-access-store.ts` | `PUT` validation: three rules, `allow|charge|block`, positive price for `charge`; `site` is server-fixed. |
| `packages/trust-layer/src/policy/robots-generator.ts` | `search`/`ai-train`/`ai-input` become `Content-Signal`; `block` becomes `no`. |
| `packages/trust-layer/src/billing/pay-per-crawl/resolve.ts` + `activation-store.ts` | Only a verified settlement provider may charge; an unverified one must not accept a proof. |
| `packages/trust-layer/src/ledger/*` | No request body, no IP, no fabricated `charged: true`. |

Attack ideas: send `Signature-Agent: "https://169.254.169.254"` (must not
fetch); redirect the directory to loopback (must not follow); replay a nonce;
change `Signature-Agent` after signing; save `ai_input=block` and confirm the
next request is `403`; set `ai_input=charge` with no settlement and confirm
`402`; spoof `Googlebot` unsigned (currently rejected by the UA heuristic —
this is the open B3 decision, see below); send many invalid origins and measure
directory-fetch cost.

**Cost/abuse (B6, not fixed in this pass):** the directory cache stores only
successful lookups, so distinct invalid origins can each trigger one outbound
fetch (bounded by the 5 s timeout, 512 KiB cap and 2 redirects). There is no
negative cache or global egress rate limit. Record the observed cost before
changing behavior; the remediation is a product/security decision.

**Search-bot decision (B3, open):** `looksLikeAutomatedAgent()` matches
`bot|crawler|spider|gpt|claude|scrapy|python-requests`, so an unsigned
`Googlebot` is rejected on a content page even when `search=allow`. Exempting
a UA would be spoofable; cryptographic identification is the only non-spoofable
path. The owner must choose between keeping the rejection and documenting it,
or adding a separately reviewed search-bot exception.

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
