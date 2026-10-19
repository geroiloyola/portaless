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
- Body: `{ "domain": "<subject domain>", "witnesses": ["<witness domain>", ...], "weights"?: { "did:apw:<domain>": <number 0..1000> } }` — 1–20 witnesses; weights optional (default 1.0, persisted before sync; the base weight is a **multiplier over the calibration factor**, see below).
- Behavior: fetches each witness's `/.well-known/apw-witnesses.json` (paginated, 10 pages × 500 max, 10 s timeout, 2 MB cap), applies all four §5.7 verifiers to every statement, stores the latest anchored observation per `(subject, witness, seq)` (a smaller anchor never overwrites a larger one), evaluates against the subject's live chain, and caches the directory entry with weighted consensus.
- **Calibration (A.4.4-style, Phase 5)**: after each sync, every witness with an observation at the consensus `seq` gains one *agree* (matched the consensus head) or one *disagree* counter; the effective weight used in the consensus is `base × (0.1 + 1.8 × (agree+1)/(agree+disagree+2))`, clamped to 1000. The factor starts at 1.0 with no data (~1.9 ceiling, ~0.1 floor); witnesses without an observation at the consensus `seq` are never counted (no data, no punishment).
- Response: `{ synced: { subjectDid, status, observations, findings, witnessesUsed, witnessesSkipped, consensus, ... } }`. Each observation carries `weight` (effective), `baseWeight`, and `calibrationFactor`. Skipped witnesses carry a reason (`witness_chain_unverified`, `witness_endpoint_unreachable`, `statement_not_anchored`, `statement_invalid:*`, `self_witness`, …). One bad witness never aborts the sync.

### `GET /admin/api/index/peers` / `POST /admin/api/index/peers`

Peer Index nodes configured on this node (inter-node synchronization, Phase 5).

- Auth: admin session, role `admin`. No step-up (only public hostnames are stored).
- `GET`: lists configured peers with their last sync state (`{ peers: [{ peerDomain, peerDid, addedAt, lastSyncAt, lastStatus, lastSubjectsCount }] }`).
- `POST` body: `{ "domain": "<peer hostname>", "action"?: "add" | "remove" }` (default `add`, idempotent, max 20 peers). `400 self_peer` when the domain is this node's own; `404` when removing a peer that does not exist.

### `POST /admin/api/index/sync-peers`

Pull each configured peer's `/.well-known/apw-index.json` and use its entries as **discovery** of (subject, witnesses): every discovered subject is re-synchronized with the exact same fail-closed pipeline as `/admin/api/index/sync` (witness chain → anchored statements → signature → deterministic `jti`). A peer never injects unverified observations — a malicious peer can only cause this node to verify real chains.

- Auth: admin session, role `admin`. No step-up.
- Body (optional): `{ "peers"?: ["<hostname>", ...] }` (default: all configured peers; max 50 subjects and 20 witnesses taken per peer entry).
- Response: `{ peers: [{ peerDomain, outcome: "ok" | "peer_unreachable" | "peer_invalid" | "self_peer", peerDid, subjectsSynced, subjectsSkipped, subjects: [{ domain, result, status? }] }], subjectsSynced }`. Peer last-sync state is persisted (`witness_index_peers`).

### Operator UI

All of the above is also available from the dashboard at **`/admin/witness-index`** (subjects table, sync-subject form, peer management) — the UI is convenience only; the public document stays `/.well-known/apw-index.json`.

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

### `GET|POST|DELETE /admin/api/apw-atproto-links`

Manage the AT Protocol handles this site claims in its `did:apw` document (the optional APW ↔ AT bridge; see `docs/architecture/identity-atproto.md`).

- Auth: admin session, role `admin` (server-side `canWrite`; no step-up).
- `GET` → `{ links: [{ siteId, handle, addedAt }] }`.
- `POST` body `{ handle }` → alta, validated with `resolvableHandle()` (official AT syntax **and** non-reserved TLD — a handle that can never resolve is not stored), normalized to lowercase, idempotent (repeating does not duplicate).
- `DELETE` body `{ handle }` → `{ removed: boolean }`.
- The stored links are published in `GET /.well-known/did.json` as `alsoKnownAs: ["at://<handle>"]`; with no links the document is unchanged. Public join of the result: `GET /trust/atproto/:handle`.

### `GET|POST|DELETE /admin/api/cloud-images`

Manage this site's **Cloud Images** — every upload is signed server-side with the site's active key (the "C2PA without a central authority" base; design and limits in [`docs/architecture/cloud-images.md`](../architecture/cloud-images.md)).

- Auth: admin session, role `admin` (server-side `canWrite`; no step-up). `GET` only requires a session.
- `POST` body `{ imageBase64, declaredOrigin }` → `201 { ok, deduplicated: false, image }`: the server hashes the bytes (`sha256`, sidecar-free), captures the contemporaneous **public** SiteTrustScore, builds the Cloud Image v1 payload, signs it with the active `did:apw` key (`typ: apw-image+jws`), embeds the sidecar in a private `pAPW` PNG chunk and stores bytes + metadata. `declaredOrigin` is **mandatory** (`human` | `ai` | `mixed`) — the declaration is inside the signed payload. PNG only, ≤ 4 MiB.
- Repeating the **same bytes** → `200 { ok: true, deduplicated: true, image }` (unique `content_hash`; the existing record wins, `declaredOrigin` is not re-declared).
- `GET` → `{ images: [record…] }` (metadata + sidecar, no bytes).
- `DELETE` body `{ imageId }` → `{ removed: boolean }`.
- Errors: `400 invalid_json_body | invalid_declared_origin | invalid_image | image_too_large | unsupported_content_type`, `404 site_identity_not_found` (no active identity to sign with). Follow-up public surfaces: `GET /images/:imageId` (bytes), `GET /trust/images/:imageId` (local verification), `POST /trust/images/verify` (standalone).

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
| `/admin/pages` , `/admin/pages/[slug]` | `GET/PUT` | Page CRUD via the real `PageStore` (D1/SQLite); server-side `canWrite(role)`. Admin may set `status: draft`, `published` or `private`; public exposure is governed by the shared publication filter. |
| `/admin/preview/pages/[slug]` | `GET` | Admin-only HTML preview for a non-public DB page; `private, no-store`, `X-Robots-Tag: noindex`, no canonical, and never falls through to the static public route |
| `/admin/permissions` | `GET/PUT` | Permissions Center: grant/revoke capabilities, including `trust:read-governance-bypass` for `reader` subjects (DID validated server-side) |
| `/admin/plugins/[pluginId]/vote` | `POST` | Community `trustScore` vote (1–5) |
| `/admin/api/plugins/run` | `POST` | Run a **registered + active** plugin through the production sandbox (`runPluginInProduction`): body `{ plugin, payload? }`; `{ manifest, code }` is resolved server-side from `PluginArtifactStore` (`plugin_artifacts` / `plugin_artifact_chunks`, checking `sha256Hex(code) === codeHash`; works on both workerd/D1 and Node/SQLite) and falls back to `PORTALESS_PLUGIN_DIR` on disk (default `packages/plugin-sandbox/examples`) only when no stored artifact exists (if neither has it on workerd, answers `503 plugin_source_backend_unavailable`); capabilities = Permissions Center ∩ manifest; `bridgeUrl` derived from the request origin. Edge execution requires `PORTALESS_CLOUDFLARE_*`/`PORTALESS_DENO_*` env credentials |
| `/admin/settlement` | `GET/PUT` | Pay-per-crawl provider configuration |
| `/admin/api/agents` | `GET/PUT/DELETE` | Agent access policy, operable from the panel (ROADMAP.md phase 12). `GET` returns the **effective** policy plus its `source` (`store` / `asset` / `default`), who wrote it and when, and `writable` for the session role. `PUT` persists the operator override in `agent_access_policy` (server-side `canWrite(role)`, server-fixed `site`); rejects an invalid rule or a `charge` with no positive `price_usd`. `DELETE` drops the override and returns what remains. Precedence: store > asset (`/.well-known/portaless-content-policy.json`) > default. No step-up, unlike `PUT /admin/permissions`: this edits the owner's own content policy, is reversible, and grants no capability |
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
