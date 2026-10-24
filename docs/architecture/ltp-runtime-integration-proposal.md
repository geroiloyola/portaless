# Proposal — wire the identity engine into the Portaless runtime

**Status: proposal only. No code, migration or activation is included. G4/G5
remain pending; B3 remains unchanged until an explicit owner decision.** See the
[canonical G1–G5 register](../protocol-apw/LTP-GATES-AND-AUTHORIZATIONS.md).
This document responds to the gap: `packages/ltp-engine` verifies identity, but
the owner cannot yet use it to control bots through Portaless configuration,
categories, grants, diagnostics and enforcement.

## 1. What exists today (evidence)

| Piece | Evidence | Current behavior |
|---|---|---|
| Global middleware | `functions/_middleware.js:217-229` | If Trust Layer is enabled, unsigned bot-like requests get `403 unsigned_automated_request` **before** the content policy is loaded. |
| B3 test matrix | `tests/unit/trust-layer-middleware.test.ts:413-430` | Current behavior is asserted for `allow`/`block`/`charge`; the proposed allow path is still `it.skip` at `:435-442`. |
| Read policy / SVRI | `functions/trust/[siteId].js:34-40,203` | Reader policy and SVRI come from `apw-resolver`; there is no per-DID category/route grant in the middleware. |
| Identity engine | `packages/ltp-engine/src/*` | Standalone library; no import from `functions/`, `server/`, `src/` or the middleware. It is not wired to runtime. |
| Versioned config precedent | `packages/trust-layer/src/net/resolution-budget-config.ts:4-9,66-107`; `docs/architecture/resolution-budget-config.md` | Typed version-1 config, CAS revision, step-up, activity; absent row means unconfigured. |
| Permissions Center | `packages/permissions/src/types.ts:13,17`; `packages/permissions/src/permission-center-ui.ts:370-380` | Subject types include `agent` and `reader`; `agent.id` is currently a Trust Layer keyId, `reader.id` is a DID, and there is no per-category agent grant yet. |
| Cloudflare Workers | `docs/protocol-apw/LTP-G2-G3-IMPLEMENTATION-SCOPE.md` | The Node connector is not covered on Workers; no adapter is authorized. |

## 2. Proposed configuration (#101 pattern, not #101's table)

Add a versioned `identity_access_config` (version 1), single row per instance,
with the same security properties as #101:

- `enabled`, `mode`: `off` | `monitor` | `enforce`; default/absent = `off`.
- `defaultAction`: `deny` (protected resources); public routes remain public.
- `routes[]`: `{ resource, action, match, category }`, closed schema, no regex
  supplied by an unauthenticated caller.
- `categories[]`: `{ id, label, description, maxRequestsPerWindow, maxBytes }`.
- `cacheTtlSeconds`, `diagnosticRetentionDays` (bounded).
- `revision`, `updatedAt`, `updatedBy`; CAS writes and `verifyStepUp` as #101.
- No secrets, no raw keys, no private DIDs.

Absence of the row preserves today's behavior. Enabling it is an explicit owner
action; migration seeds nothing.

## 3. One category per DID and explicit grants

Preferred design: reuse the Permissions Center as the grant source rather than
creating a parallel authorization store.

- Reuse/extend the existing `agent` subject: today `agent.id` is a Trust Layer keyId, so the proposal must canonicalize it to `did:apw:<domain>` (or add an explicit DID field) before matching grants. `reader.id` is already a DID.
- Add capability `agent-category:<category>`; a grant is explicit and auditable.
- Optional constraints: `resources`, `actions`, `expiresAt`, `maxBytes`,
  `maxRequests`; no wildcard by default.
- A DID can hold multiple grants, but one category per `(did, resource, action)`;
  conflicting grants fail closed (or require an explicit precedence rule).
- Revocation is immediate on the next request; cache entries carry the grant
  revision and are invalidated by it.
- Unknown/unverified DID never auto-matches a public or default category.

## 4. Runtime flow

1. Public routes and `/.well-known/*`: unchanged.
2. If `identity_access_config` is absent/off: unchanged (including B3).
3. If enabled:
   - Resolve the Web Bot Auth agent key and, when present, the `did:apw`
     identity through the accepted G2/G3 path (no Workers path yet).
   - Failure to resolve/verify yields `401`/`503` according to the existing
     failure classes; never a grant.
   - Map `(method, path)` to `(resource, action)` using the configured closed
     route table.
   - Require an explicit grant for `(did, category, resource, action)`.
   - Apply the per-grant budget and the existing D7 operation limits.
   - `next()` only on allow; otherwise a structured denial.
4. `monitor` mode performs the same resolution and records what *would* happen,
   but does not change the response. This is the safe rollout mode.

## 5. Diagnostics ("why denied")

Return and persist a structured object, never secrets or raw headers:

```json
{
  "decision": "deny",
  "reason": "grant_missing",
  "did": "did:apw:reader.example",
  "category": "ai_input",
  "resource": "/pages/foo",
  "action": "read",
  "identity": "verified",
  "grantRevision": 3,
  "policyRevision": 7,
  "budget": { "attemptsRemaining": 0, "bytesRemaining": 0 }
}
```

Reason codes: `policy_disabled`, `identity_missing`, `identity_unverified`,
`identity_expired`, `category_unknown`, `grant_missing`, `grant_expired`,
`grant_revoked`, `budget_exhausted`, `deadline_exceeded`, `route_unmapped`,
`workers_unsupported`. An admin-only `GET /admin/api/agent-access/diagnose`
returns the same explanation for a supplied DID/route without exposing another
site's data.

## 6. B3 behavior and migration

- **Today:** unsigned + bot-like + `ai_input=allow` → `403` before policy. The
  owner has not decided otherwise; `it.skip` remains.
- **Proposal:** in `enforce` mode, keep the current `403` for unsigned bot-like
  requests. In `monitor` mode, record the unsigned/bot observation but preserve
  today's response. Do **not** silently turn `ai_input=allow` into an implicit
  grant.
- A future B3 decision could allow unsigned bot-like traffic only on explicitly
  public routes; that requires a separate recorded decision and tests. It is not
  part of this proposal.
- **Migration:** no row, no grant, no change. Existing installations keep the
  current middleware behavior. Enable per site, run `monitor`, compare
  diagnostics, then `enforce`; rollback is setting `mode=off` (or deleting the
  row). No data backfill and no default allow.

## 7. Test plan

- Unit: config schema/CAS/step-up; route mapping; category/grant matching;
  expiry/revocation; deny-reason mapping; no secret leakage.
- Integration (middleware): signed verified DID with grant → `next()`;
  verified DID without grant → deny; unverified/expired → deny/503; unsigned
  bot-like in monitor vs enforce; public routes unchanged; policy absent =
  today's behavior; budget exhaustion fails closed.
- B3 matrix: keep the existing `allow`/`block`/`charge` cases; add monitor-mode
  cases; keep the proposed allow path skipped until the owner decides.
- Permissions: grant/revoke round-trip, stale revision, cross-site isolation.
- Migration: upgrade with no rows → byte-identical behavior; downgrade/rollback;
  CAS conflict returns 409.
- E2E: admin configures a category, grants one DID, sees allow/deny and
  diagnostics; another DID remains denied.
- Workers: explicitly out of scope; add a test that the Node-only adapter is not
  selected there and the feature stays disabled until an adapter exists.

## 8. Open decisions

- Reuse Permissions Center subjects/capabilities vs. a new grant table.
- Default action and which routes are protected when the feature is enabled.
- Whether B3 ever allows unsigned bot-like traffic, and on which public routes.
- Cache TTL and multi-instance invalidation semantics.
- Workers adapter/egress proxy, if ever authorized.
- Owner consent for a controlled DoH smoke test and any live enforcement.

Until these are decided and recorded, this is a proposal; `ltp-engine` remains a
library and the current bot behavior is unchanged.
