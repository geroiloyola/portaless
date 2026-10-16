# Security review guide — for a second pair of eyes

This document exists so someone **other than the author** can perform the
minimal external security review that Phase 3 of
[`ROADMAP.md`](../ROADMAP.md) requires before the public Beta. You do not
need to know the whole codebase: the two surfaces below are the ones with
the highest damage if they fail, and this guide maps exactly where they
live, what they promise, and how to break them.

You do not need commit rights to review. Findings can be reported as
issues or plain messages; severity is your judgment, not a checklist.

**Refreshed 2026-10-16** to cover the Phase 14 changes: execution from the
stored artifact (§14.1) and the capability backends living in one place with
per-plugin storage quotas (§14.2). If a row below is stale, the code is right
and this guide is the bug — say so.

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
- `tests/browser/*.spec.ts` — real browser flows against the self-host
  runtime (`npx playwright test`).

Real-API verification of the edge adapters (needs your own credentials):

```bash
node node_modules/tsx/dist/cli.mjs scripts/verify-sandbox-adapters.ts
```

## What "done" looks like for this review

There is no formal certification. The Phase 3 exit criterion is satisfied
when **someone other than the author** has read the two surfaces above,
run (or clearly reasoned through) at least the attack ideas, and stated
in writing: "I reviewed X and Y; findings are Z (or: no findings at
this depth)." Depth is your honest call; a 90-minute focused pass that
surfaces one real issue is worth more than a week of skimming.
