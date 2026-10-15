# Security review guide — for a second pair of eyes

This document exists so someone **other than the author** can perform the
minimal external security review that Phase 3 of
[`ROADMAP.md`](../ROADMAP.md) requires before the public Beta. You do not
need to know the whole codebase: the two surfaces below are the ones with
the highest damage if they fail, and this guide maps exactly where they
live, what they promise, and how to break them.

You do not need commit rights to review. Findings can be reported as
issues or plain messages; severity is your judgment, not a checklist.

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
| `functions/api/internal/capability-bridge.js` | The HTTP bridge non-network capabilities go through. Token validation, capability allowlist per token. |
| `infra/cloudflare/dispatcher/src/index.js` | The public dispatcher Worker: token fail-closed, script-name validation. |
| `packages/plugin-sandbox/src/runtime/production-plugin-runner.ts` | How granted ∩ requested is computed before execution. |

Attack ideas: a plugin requesting `trust:read-governance-bypass`; a
bootstrap that keeps a reference to the real `fetch` (does the
best-effort host check actually run?); invoking the dispatcher URL
without the token; a `scriptName` header with path characters; replaying
a capability-bridge token after its TTL.

### 3. Plugin installer (added 2026-10-15 — NEW, not yet reviewed)

**Promise**: installing a plugin by HTTP never runs anything the publisher
did not sign, never grants a capability on its own, and cannot be replayed
with different bytes under the same version.

This surface did **not** exist when this guide was written. It ships behind
`PORTALESS_PLUGIN_INSTALLER`, **off by default** (404 without it), precisely
because it is unreviewed.

Key files, in review order:

| File | What to check |
|---|---|
| `functions/admin/api/plugins/install.js` | Step-up enforced before anything; the signed manifest verified against the **resolved** publisher identity; install grants nothing; immutability `(publisher, name, version) → code hash`. |
| `functions/admin/api/plugins/uninstall.js` | Step-up; revokes the plugin's grants on removal. |
| `packages/apw-resolver/src/did-apw/plugin-manifest.ts` | The signature covers `requestedCapabilities`; `typ` is `apw-plugin-manifest+jws`. |
| `packages/plugin-sandbox/src/registry/plugin-artifacts.ts` | Chunked BLOB storage, hard per-artifact cap, never base64. |
| `packages/plugin-sandbox/src/install/reconcile.ts` | Removed capabilities pruned; expanded capabilities never auto-granted. |

Attack ideas: a JWS whose `publisher` is not the resolved DID; a manifest
whose `requestedCapabilities` were changed after signing (must fail); a
re-install with different code under the same version (must be `409`); a
session without step-up (must be `401`); enabling the flag without noticing
that the runtime still reads code from disk.

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
