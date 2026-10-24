# LTP runtime integration — owner decisions before implementation

**Status: decision list only. No code, migration or activation. G4/G5 remain
pending; B3 is unchanged.** Extracted from
[the runtime integration proposal](./ltp-runtime-integration-proposal.md) so the
owner can decide one item at a time. Each item lists options, a recommendation
and the evidence to check; none is approved by this document.

| ID | Decision | Recommendation |
|---|---|---|
| D1 | B3: unsigned bot-like traffic | Keep the current 403; no implicit allow. |
| D2 | Category model per DID | One effective category per `(did, resource, action)`; explicit grants; conflicts fail closed. |
| D3 | Defaults and rollout | `off` by default; `monitor` before `enforce`; default deny for protected resources. |
| D4 | Which resources are governed first | Public content reads only, in monitor; exclude discovery/health/admin. |
| D5 | Diagnostic retention | 30 days max, admin-only, aggregate plus reason; no raw IP/headers. |
| D6 | Panel display | Aggregate by category first; per-DID detail on demand; never show keys/secrets or a public numeric score. |

## D1 — B3: unsigned bot-like traffic

**Question:** may an unsigned request whose User-Agent looks automated proceed
when `ai_input=allow`?

Options:

- **A. Keep current behavior (recommended).** Unsigned + bot-like → `403`
  before policy. `it.skip` remains.
- **B. Monitor only.** Record the observation but keep the `403`. No behavior
  change; useful for measuring.
- **C. Allow on explicitly public routes only.** A separate owner decision would
  define the route list; identity is still not verified.
- **D. Allow because `ai_input=allow`.** Not recommended: a self-declared
  User-Agent is forgeable and would turn a policy rule into an implicit grant.

Recommendation: **A now.** If the owner wants a change, choose B first and
consider C only with a recorded route list and tests. Do not choose D.

Evidence: `functions/_middleware.js:217-229`; existing matrix
`tests/unit/trust-layer-middleware.test.ts:413-430`; pending proposal
`:435-442`; proposal §6.

## D2 — Category model per DID

**Question:** how are categories attached to a DID and what happens with
overlapping grants?

Options:

- **A. One effective category per `(did, resource, action)` (recommended).**
  Multiple grants may exist, but only one can be effective; a conflict fails
  closed until the owner resolves it.
- **B. Multiple categories per DID with precedence.** More flexible, but the
  precedence rule becomes part of the security contract and needs tests.
- **C. Wildcard categories/actions.** Simplest to configure, but easy to grant
  more than intended; not recommended for the first version.

Recommendation: **A**, reusing the Permissions Center. Today `agent.id` is a
Trust Layer keyId and `reader.id` is a DID (`packages/permissions/src/types.ts:13,17`);
the proposal must canonicalize the agent subject to `did:apw:<domain>` before
matching. No wildcard by default; every grant is explicit and revocable.

Evidence: proposal §3; `packages/permissions/src/types.ts:13,17`;
`permission-center-ui.ts:370-380`.

## D3 — Defaults and rollout

**Question:** what is the default when the new configuration is absent, and how
does the owner turn it on?

Options:

- **A. `off` by default; `monitor` before `enforce` (recommended).** Absent row
  means today's behavior. Monitor records would-be decisions without changing
  responses; enforce only after review.
- **B. `enforce` immediately.** Faster, but changes bot behavior on upgrade;
  not recommended for existing installations.
- **C. Implicit `monitor` for everyone.** Changes storage/work without an owner
  action; not recommended.

Recommendation: **A.** Default action is **deny** for protected resources;
public discovery routes (`/.well-known/*`, `robots.txt`, `llms.txt`, `sitemap.xml`,
`/blog/*.md`) remain public (`packages/trust-layer/src/policy/public-bot-routes.ts:12-18`).
No row, no grant, no change. Rollback is `mode=off` or deleting the row.

Evidence: proposal §2/§4/§6; #101 config pattern
`packages/trust-layer/src/net/resolution-budget-config.ts:4-9,66-107`.

## D4 — Which resources are governed first

**Question:** which routes should the first enforcement cover?

Options:

- **A. Public content reads only (recommended):** `/pages/*`, `/blog/*`,
  `/docs/*` (excluding `.md` discovery), in `monitor` first.
- **B. Content plus JSON APIs.** Broader, but API consumers and MCP need their
  own inventory and failure semantics.
- **C. All routes.** Highest risk; admin/auth, `/trust/*`, health and settlement
  have separate authorization flows and should not be folded into one first cut.

Recommendation: **A.** Do not govern `/.well-known/*`, `robots.txt`,
`llms.txt`, `sitemap.xml`, `/blog/*.md`, `/healthz`, admin/session routes or
existing settlement endpoints in the first cut. Add APIs only after their
consumers and diagnostics are enumerated.

Evidence: `functions/_middleware.js:214`;
`packages/trust-layer/src/policy/public-bot-routes.ts:12-18`; proposal §4.

## D5 — Diagnostic retention

**Question:** how long are “why denied” records kept, and what do they contain?

Options:

- **A. No retention.** Minimal data, but impossible to explain a pattern after
  the fact.
- **B. 30 days, admin-only, bounded (recommended).** Store decision, reason,
  category, resource/action, policy/grant revision, verified/unverified status
  and aggregate counts. No raw IP, full headers, signatures or keys.
- **C. 90 days or indefinite.** More forensics, more privacy/storage risk;
  needs a separate retention/DPIA decision.

Recommendation: **B**, configurable down to 0, with a hard cap and automatic
deletion. Never store secrets; never expose another site's diagnostics. The
existing activity/audit pattern can be reused, but this document does not choose
the table or write a migration.

Evidence: proposal §5; existing activity patterns in `packages/trust-layer` and
admin APIs (no new schema in this document).

## D6 — What the panel shows

**Question:** what does the owner see in the dashboard?

Options:

- **A. Aggregate only.** Counts by category/reason; no per-DID detail.
- **B. Aggregate plus per-DID detail on demand (recommended).** Start with
  category/reason counts; a second view shows one DID's verified status,
  category, grant revision, decision and deny reason. No raw keys, signatures,
  headers or secrets.
- **C. Full diagnostics everywhere.** Highest leak/confusion risk, especially if
  the panel is exposed to non-owners; not recommended.

Recommendation: **B.** Show “verified/unverified/expired”, the effective
category, the matched/missing grant, the exact reason code and the policy/grant
revision. Never show a public numeric SVRI; the public surface stays qualitative
(`SVRI-v1.0.md:93-105`). Per-DID detail is admin-only and audited.

Evidence: proposal §5; `functions/trust/[siteId].js` public/administrative
separation; `SVRI-v1.0.md:93-105`.

## Decisions explicitly outside this list

- G4 reputation/SVRI math: `PENDING_AUTHORIZATION`; see the
  [G4 pre-review](../protocol-apw/LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md).
- G5 offline DNSSEC: `PENDING_AUTHORIZATION`.
- Workers adapter: not covered by the Node connector; would need its own
  pinned-connect/egress design and tests.
- Controlled DoH smoke test: requires operator consent and a separate recorded
  activation decision.

No item in this document authorizes implementation. The owner must record each
decision; #106 remains a review candidate, not an activation.
