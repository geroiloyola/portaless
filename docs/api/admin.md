# Admin API catalog

Endpoints under `/admin/api/*` (plus a few under `/admin/*`) serve the **site's own administrators** and automation acting as them. They are not a public protocol surface: authentication is a session cookie from `/admin/login` (with optional MFA), and writes require role `admin` (server-side `canWrite(role)` guard on every route). Sensitive routes additionally require **step-up** (password + TOTP re-prompt).

> These docs exist so third parties building integrations on top of a Portaless deployment know what is available and what it requires. Public, unauthenticated protocol surfaces are in [`well-known.md`](./well-known.md).

## Auth model

| Requirement | Applies to |
|---|---|
| Session cookie (`/admin/login`, MFA via `/admin/login-mfa` when enabled) | All `/admin/*` routes |
| Role `admin` (not `viewer`) | All writes (PUT/POST/DELETE) |
| Step-up (password + TOTP) | Identity rotation, sensitive security actions, `reader-conduct/emit` |
| Pre-login allowlist | Only `2FA`, password reset, and OAuth start/callback routes work without a session (exact allowlist in `functions/admin/_middleware.js`) |

---

## Protocol APW and Index (the surface this guide is mainly about)

### `POST /admin/api/witness/record`

Record an external-witness observation of another site (spec §5.7).

- Auth: admin session, role `admin`. No step-up (everything it fetches is public).
- Body: `{ "domain": "<subject domain, no scheme>" }`.
- Behavior: resolves the subject's chain via `resolveApwHistory()`, verifies it end to end, signs an `apw-witness+jws` statement with the site's active key (deterministic `jti`), and logs it into the site's own chained history. Repeating the same head is idempotent (`duplicate_attestation`).
- Errors: `400` invalid domain; `403` insufficient role; the subject chain failing verification is reported, never logged blindly.

### `POST /admin/api/index/sync`

Synchronize the local Portaless Index directory from a configured set of witnesses (spec §5.7 "Aggregator").

- Auth: admin session, role `admin`. No step-up.
- Body: `{ "domain": "<subject domain>", "witnesses": ["<witness domain>", ...], "weights"?: { "did:apw:<domain>": <number 0..1000> } }` — 1–20 witnesses; weights optional (default 1.0, persisted before sync).
- Behavior: fetches each witness's `/.well-known/apw-witnesses.json` (paginated, 10 pages × 500 max, 10 s timeout, 2 MB cap), applies all four §5.7 verifiers to every statement, stores the latest anchored observation per `(subject, witness, seq)` (a smaller anchor never overwrites a larger one), evaluates against the subject's live chain, and caches the directory entry with weighted consensus.
- Response: `{ synced: { subjectDid, status, observations, findings, witnessesUsed, witnessesSkipped, consensus, ... } }`. Skipped witnesses carry a reason (`witness_chain_unverified`, `witness_endpoint_unreachable`, `statement_not_anchored`, `statement_invalid:*`, `self_witness`, …). One bad witness never aborts the sync.

### `GET /admin/api/index/subjects`

List the cached index directory entries.

- Auth: admin session.
- Query: optional `?subject=<did:apw:…>` to filter one subject.
- Response: the same entry shape published (minus nothing — the admin sees exactly what the public document carries, including `observations`, `findings`, `witnessesSkipped`). Corrupt cached rows are skipped safely.

### `GET /.well-known/apw-index.json` (public)

The directory produced by the syncs above — see [`well-known.md`](./well-known.md#get-well-knownapw-indexjson).

### `POST /admin/api/reader-conduct/emit`

Emit `reader_conduct` attestations for a period from the ledger (spec §6.4).

- Auth: admin session + **step-up**.
- Requirements: only emits what the ledger says about the agent for the period, with a deterministic `jti`; the requester's site must have its active key `k` resolvable. Repeating returns existing `jti`s as `already_emitted`. Only `respected_policy` and `policy_violation` are emitted today (the other three categories await data the origin does not have — spec §6.4).

### `GET /admin/api/apw-verification-status`

APW verification checklist state for the dashboard, including the structured `anchor: { status, publishedH, localH, localSeq }` field used by the deferred onboarding checklist.

### `GET|PUT /admin/api/site-identity`

Read/update the site's APW identity (key history, rotation state). Rotation is a step-up action; the private key of a retired key is deleted at rotation.

---

## SiteTrustScore management

| Endpoint | Method | Notes |
|---|---|---|
| `/admin/site-trust/:siteId/self` | `PUT` | Publish a signed `self` attestation (spec §5.3); requires site identity for the JWS, stores `signed: false` rows without it |
| `/admin/api/authorized-agents` | `GET/POST/…` | Manage the Web Bot Auth `authorized_agents` allowlist (load/replace/remove agents) |
| `/admin/api/authorized-escrow-providers` | `GET/POST/PUT/…` | Manage escrow providers; `publicKeyJwk` load/replace/remove via `POST`/`PUT` without rotating the API key (rejects JWKs with `d`) |

Public writes from third parties hit `/trust/:siteId/*` instead (Web Bot Auth / API key auth — see the spec §5.3 table), not these admin routes.

## Content, permissions, plugins, settlement

| Endpoint | Method | Notes |
|---|---|---|
| `/admin/pages` , `/admin/pages/[slug]` | `GET/PUT` | Page CRUD via the real `PageStore` (D1/SQLite); server-side `canWrite(role)` |
| `/admin/permissions` | `GET/PUT` | Permissions Center: grant/revoke capabilities, including `trust:read-governance-bypass` for `reader` subjects (DID validated server-side) |
| `/admin/plugins/[pluginId]/vote` | `POST` | Community `trustScore` vote (1–5) |
| `/admin/api/plugins/run` | `POST` | Run a **registered + active** plugin through the production sandbox (`runPluginInProduction`): body `{ plugin, payload? }`; code is loaded server-side from `PORTALESS_PLUGIN_DIR` (default `packages/plugin-sandbox/examples`; Node/self-host only — on workerd it answers `503 plugin_source_backend_unavailable`); capabilities = Permissions Center ∩ manifest; `bridgeUrl` derived from the request origin. Edge execution requires `PORTALESS_CLOUDFLARE_*`/`PORTALESS_DENO_*` env credentials |
| `/admin/settlement` | `GET/PUT` | Pay-per-crawl provider configuration |
| `/admin/api/product-preview` | `GET` | Medusa/Mercur product preview for the visual editor |

## Account, OAuth, wizard

| Endpoint | Notes |
|---|---|
| `/admin/login`, `/admin/login-mfa` | Session + MFA (TOTP) |
| `/admin/api/change-password`, `/admin/api/password-events` | Password lifecycle and event history |
| `/admin/password-reset/request`, `/confirm` | Reset flow (rate-limited per IP + user, hashed buckets) |
| `/admin/api/oauth/github/*` | GitHub App OAuth for the onboarding wizard (PKCE, refresh) |
| `/admin/api/wizard/*` | Onboarding wizard steps (admin status, page generation) |

## Honesty notes

- All routes above are implemented and unit-tested in this repository; end-to-end runs against real third-party accounts (GitHub App OAuth, Cloudflare zones) are still listed as external pending tasks in [`ROADMAP.md`](../../ROADMAP.md).
- Admin responses may carry Spanish-language error strings today (the codebase predates the English-docs restructuring); the error **codes** (`invalid_domain`, `forbidden`, `duplicate_attestation`, …) are stable and English.
