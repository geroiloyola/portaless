# Portaless Roadmap

> **Source of truth for CURRENT status** (October 2026, post-reconciliation with APW spec v1.3): only what is true today — what is in production, what is missing, and what depends on third parties. The long-form Spanish version with full narrative context is archived in [`ROADMAP_es.md`](./ROADMAP_es.md) (kept intact; English wins on any discrepancy). Release history: [`CHANGELOG.md`](./CHANGELOG.md). PR-by-PR history: [`docs/roadmap/ROADMAP-ARCHIVE.md`](./docs/roadmap/ROADMAP-ARCHIVE.md) (Spanish).

**Legend**: `[x]` shipped (merged to `main`, verifiable by commit) · `[~]` implemented, awaiting a real-world external step · `[ ]` pending.

Categories are by **who** must resolve the piece, not by priority.

---

## In production

### Foundation, auth and licensing

- `[x]` `main` branch protection; `admin`/`viewer` roles with `canWrite(role)` DOM guard + server-side validation across the dashboard.
- `[x]` Licensing: core AGPL-3.0; APW specification CC BY 4.0; Plugin SDK planned MIT ([`licensing boundaries`](./docs/architecture/licensing-boundaries.md)).
- `[x]` Password recovery, 2FA (TOTP), OAuth/SSO; step-up (password + TOTP) for sensitive actions.
- `[x]` Exact pre-login allowlist for `/admin/*`; MFA attempt limits; hashed-bucket reset rate limits; `password_change_events` history; all sessions invalidated on password change/reset.

### Persistence, install, plugins

- `[x]` Real D1/SQLite persistence in every store (pages, permissions, ledger, users, sessions, MFA challenges, rate limits, APW identity) with explicit-fail factories (no silent in-memory fallback).
- `[x]` Master `schema.sql` + `npm run setup` (schema + initial admin in one command; `npm run setup:d1` for D1). Regenerated with all 13 real sources (5 package schemas + 8 `schema-additions/`), idempotent, SQLite-verified.
- `[x]` `isolated-vm` sandbox with reusable isolate pool; 12/12 plugin capabilities bridged via ephemeral `CapabilityTokenStore` (TTL 5 min, per-plugin scope); production `createSandboxRuntime()` factory; permission-center enforcement (granted ∩ manifest, read per call); dynamic plugin registry with community `trustScore`.

### Trust Layer, identity and Protocol APW

- `[x]` Web Bot Auth (RFC 9421, Ed25519) with shared draft-03 rules, key-directory cache, nonce uniqueness (shared across instances via D1/SQLite since v0.0.9.31 — in-memory fallback for single-process dev).
- `[x]` Experimental ML-DSA (FIPS 204) in the SiteTrustScore `agent` source only; middleware remains Ed25519-only.
- `[x]` SiteTrustScore with all 4 sources (`self`, `agent`, `community`, `escrow_report`) and full admin lifecycle for `authorized_agents` and escrow providers (Ed25519 public JWK loaded/rotated/removed without rotating the API key; signed reports rejected without it). Limits: empty allowlists by default; `community` is local, unverifiable voting (spec gap B7).
- `[x]` Pay-per-crawl with swappable providers (`cloudflare-pay-per-crawl`): in-band `crawler-price`; activation requires verified Cloudflare token + step-up + APW identity. No active provider → `charge` responds 402 `settlement: "not_available"`.
- `[x]` **Protocol APW v1.3 complete** ([spec](./docs/protocol-apw/APW-SPEC-v1.3.md) · [vectors](./docs/protocol-apw/APW-VECTORS-v1.3.md)): DNS-over-HTTPS TXT `_apw.` resolution, manifest v1/v2 (`k`, `h`), `did:apw` with key history + rotation, `/.well-known/did.json`, site JWS with JCS (`/.well-known/apw-manifest.jws`), signed attestations (`agent`, `escrow_report`, `self`), DNS-anchored chained history (`/.well-known/apw-log.json`), attestation bundle (`/.well-known/apw-attestations.json`), dimension scoring (Annex A) with R-05 calibration, fail-closed read policies, and `reader_conduct` reputation with completeness and ledger-backed emission. Closes spec gaps B1–B6 and B9; B7 (portable `community`) stays open.
- `[x]` **Per-dimension public override (A.6)**: owner can publish any *governed* dimension via `public_overrides` on `site_trust_read_policies`; surfaced by `GET /trust/:siteId` in `projectTrustView()`. Public level cannot be hidden; unknown dimensions rejected.
- `[x]` **External witnesses (ERRATA E-10, spec §5.7)**: a site with identity observes another's chain and publishes a signed statement (`apw-witness+jws`, deterministic `jti`) at `/.well-known/apw-witnesses.json`, logged in its own chained history. Fail-closed evaluation: `head_mismatch`, `equivocation`, `backdated_entry`. Recorded via `POST /admin/api/witness/record`.
- `[x]` **Semi-automatic `h` anchoring**: TXT v2 computation with live `k`+`h` via `dnslink/cli.mjs --anchor --domain` and the dashboard checklist; witnesses anchor heads without touching DNS. Pasting the TXT into the DNS provider stays manual (no standardized DNS API).
- `[x]` **Automatic `reader_conduct` emission**: Trust Layer middleware emits on verified access (deterministic `jti`, `reader_conduct_jti` index with history seeding, per-isolate throttle, `APW_AUTO_EMIT_CONDUCT=false` opt-out). Ledger now records `allow` accesses too.
- `[x]` **Per-reader bypass (spec §6.5, closes E-8)**: Permissions Center grants `trust:read-governance-bypass` over a reader DID; `GET /trust/:siteId` passes them without thresholds. Does not skip APW identity (§6.3) or a corrupt policy; no store → no bypass.
- `[x]` **Non-active reader keys (spec §6.3)**: a signature whose fingerprint is not `k` is accepted if the key is in the reader's verified history, signed ≥1 chain entry, and its `[validFrom, validTo + 10 min grace]` window covers the request; otherwise `apw_unresolvable: key_not_bound_to_apw` and the cache TTL clamps to window close.
- `[x]` **Public W-dimension projection (spec §6.6, closes E-8)**: `GET /trust/:siteId` computes site dimensions from its snapshot and always publishes `projection { dimensions, aggregates, governed }`; on denial, only the public set (W-01, W-04, W-06, W-07, W-09) plus all aggregates.

### Portaless Index — local witness aggregator (spec §5.7)

- `[x]` `witness-index.ts` + `witness-index-store.ts` (tables `witness_observations`, `witness_weights`, `witness_index_subjects`; D1/SQLite/InMemory). `POST /admin/api/index/sync` and `GET /admin/api/index/subjects` (admin role); public directory at `GET /.well-known/apw-index.json` (plain, re-verifiable document). End-to-end fail-closed pull of configured witnesses (chain verified, `att` anchored, signature, deterministic `jti`), head evaluation, weighted consensus by static per-witness weight (default 1.0). Out of scope, documented in spec §5.7/§7: A.4.4-style weight calibration, gossip between index nodes, manifest/SiteTrustScore discovery. Integrator guide: [`docs/api/well-known.md`](./docs/api/well-known.md).

### Editor, MCP, onboarding, CI, self-host

- `[x]` Visual editor (`/admin/editor`) with real block rendering, ProductGrid preview, drag-and-drop reorder, column nesting; 4 link-in-bio elements.
- `[x]` Native SEO/GEO (JsonLd, SeoHead, canonical); AI discovery: `/llms.txt` (llmstxt.org v2), per-post markdown, single Trust-Layer-generated `robots.txt` with Content Signals, full sitemap; drafts 404.
- `[x]` MCP server: 7 real tools over real D1/SQLite stores. Agent identity is now per-invocation on the HTTP transport (Option B, bearer tokens); stdio keeps the per-process env identity (Option A, SDK limitation).
- `[x]` Onboarding: 5-step wizard (intent templates, GitHub App OAuth with PKCE, one-time `did:apw` + admin-credentials export), deferred dashboard checklist (APW verification banner with exact TXT), terminal-less first-run `/setup` on the Node runtime.
- `[x]` CI on Node 24 (`npm test` blocks), production `validateManifest()` on every manifest, coverage suite (baseline 47.43% lines; floors 45/44/46/40), setup smoke, `docker-smoke` job.
- `[x]` Self-host ready: Node runtime for Pages Functions (routing, prefixed middleware, `env.ASSETS`, `/healthz`, no silent memory fallback), `better-sqlite3` everywhere, `engines.node >= 24`, Docker multi-stage + `docker-compose.yml` + `railway.json` + `render.yaml` (`/data` volume).

---

## In development (internal — depends only on Portaless)

### Protocol APW (remaining spec v1.3 items)

- `[ ]` **Enable R-05 in policies** — blocked by *data*, not config: R-05 is the calibration of attestations the reader *emits* (A.4.4), and `loadReaderConduct` only loads what it *received*; every reader today is R-05 = 4.0 with weight 0, so enabling `policyDimensions["R-05"]` would 403 everyone. Needs (1) a flow where readers emit attestations over subjects (today only anonymous community voting by IP, no DID) and (2) a corpus of other emitters on the same (subject, dimension) for leave-one-out consensus — indexes or witnesses (spec §7). Anchored in `tests/unit/apw-reader-conduct-config.test.ts`; documented in spec §6.5 and ERRATA E-9.
- `[ ]` **Signals `rate_respected`, `paid_as_agreed`, `redistribution`** (spec §6.4) — blocked by data: the ledger only records `requests_total` and `policy_violations_detected`; the middleware passes `charged: false` on all four paths. Each waits for its own input: a rate in the content policy plus rejection counters; a settlement that tells the origin whether the crawler actually paid (current Cloudflare PPC settles out-of-band); and witnesses or denunciations for redistribution, which the origin cannot observe.

### Security, sandbox, agent identity, misc

- `[x]` Production caller of `createSandboxRuntime()` for edge adapters — `runPluginInProduction()` (`packages/plugin-sandbox/src/runtime/production-plugin-runner.ts`) + `POST /admin/api/plugins/run` (admin role, registered+active plugins, code from `PORTALESS_PLUGIN_DIR`, granted ∩ requested, shared bridge token store, per-request `bridgeUrl`). Real edge execution still needs `PORTALESS_CLOUDFLARE_*`/`PORTALESS_DENO_*` credentials (External section); on workerd the endpoint's disk loader answers an explicit `503 plugin_source_backend_unavailable` (self-host/Node works out of the box).
- `[x]` ML-DSA in the middleware (`webbotauth/verify.ts`), not only in the SiteTrustScore `agent` source — the middleware now verifies ML-DSA-44/65/87 directory keys (`kty: "AKP"`, `pub`) over the same RFC 9421 signature base, via the shared `webbotauth/ml-dsa.ts` module (one implementation for both verifiers; `@noble/post-quantum` lazy-loaded, explicit `ml_dsa_unavailable` if it can't load). The optional `alg` parameter accepts `ml-dsa-*` case-insensitively and must match the directory key (`algorithm_key_mismatch`). 13 real-signature tests in `webbotauth-verify-ml-dsa.test.ts` (per-algorithm, tampering, replay, cache). Still experimental: no independent audit of `@noble/post-quantum`, no verified run against a real external ML-DSA agent.
- `[x]` Web Bot Auth nonces shared across instances (D1/SQLite with TTL, `auth_mfa_challenges` pattern).
- `[x]` Fold `settlement_provider_activations` into master `schema.sql` + `REQUIRED_TABLES`.
- `[x]` Trustworthy `X-Forwarded-For` proxy handling for self-host (reset rate limit) — `clientIpFromHeaders()` (password-reset rate limit) and `passwordEventContextFromRequest()` (audit trail) now honor the runtime-computed `x-portaless-client-ip` when `env.__PORTALESS_RUNTIME === "node"`, instead of raw `X-Forwarded-For` that any client could spoof to rotate the per-IP bucket. Behind a proxy, `PORTALESS_TRUSTED_PROXIES` (documented in `docs/self-hosting.md`) makes the rate limit follow the real client chain; integration tests boot the real Node runtime against the real endpoint.
- `[ ]` Email-based step-up verification for sensitive actions — base landed in v0.0.9.10 (`email:send` sender abstraction with explicit webhook/dev/unavailable states + `auth_email_stepup_codes` OTP challenge store + `AuthService.requestEmailStepUpCode()`/`verifyEmailStepUpCode()`); wiring into the sensitive endpoints (rotate `did:apw`, change password, settlement activation) still pending review — today they remain password + TOTP only.
- `[x]` Browser tests (Playwright) for `/admin/security`, `/admin/wizard/rotate-identity`, wizard step 4 — `playwright.config.ts` + `scripts/browser-test-server.mjs` (self-host Node runtime over `dist/` with a temp SQLite; seeds an admin and a `did:apw` identity so the three screens have deterministic state) + 7 tests in `tests/browser/`. The suite found two real production bugs, both fixed: (1) the Node runtime passed a **new context literal per middleware**, so the `context.data = { user }` reassignment of `functions/admin/_middleware.js` never reached the handler and **every authenticated `/admin/*` API returned 401 under self-host** (the dispatch now shares one context object per request, Cloudflare Pages semantics; regression in `self-host-node-runtime.test.ts`); (2) `SqliteUsersStore` and `D1UsersStore` never implemented `setPasswordByUsername`, so change-password and reset-completion crashed at runtime on **both real backends** (only the in-memory store had it). Honest limits: the DID itself is domain-bound (`did:apw:<domain>`) so rotation changes the active key, not the DID string — the key change is covered by `apw-site-identity-rotation.test.ts`, not by the browser UI.
- `[x]` Real users stores (D1/SQLite) implement the full `UsersStore` surface — `setTotpSecret`/`clearTotpSecret`/`findByOAuthSubject`/`linkOAuthAccount`/`createOAuthUser` (and `email` on `createUser`) used to exist only on `InMemoryUsersStore`, so enabling 2FA or login-with-OAuth in production hit `not a function` (same class of bug as the missing `setPasswordByUsername`, fixed earlier). Both stores now implement the whole interface; the canonical `users` table gained `email`, `provider`, `totp_secret`, `totp_enabled_at`, `oauth_provider`, `oauth_subject` (+ `idx_users_oauth`), self-applied with `ALTER TABLE` on pre-v0.0.9.10 databases (duplicate-column swallowed, `site_identity_keys` pattern), master `schema.sql` regenerated. Tests: `users-store-totp-oauth.test.ts` (6) — full surface on a new schema and on a legacy 4-column database (SQLite real + D1 fake over better-sqlite3), plus AuthService integration with the real store (real TOTP code through `confirmTotpEnrollment`/`verifyStepUp`, `loginWithOAuth` create/find/link paths).
- `[x]` Raise Full Tests coverage floors from 45/44/46/40 toward 60–70%, never lowering them. (Floors now **68 lines / 67 statements / 66 functions / 65 branches**, measured baseline 71.39/70.20/69.21/68.53; ~95 new unit tests across 13 files — trust-layer middleware, admin auth/agents/escrow/witness/self/vote endpoints, OAuth callback, `.well-known` APW endpoints, JSON-LD, D1 site-trust store, MCP audit, capability-token stores.)
- `[x]` MCP server: per-invocation agent identity. Resolved for the HTTP transport (Option B): `resolveAgent()` runs on **every** tool invocation; `PORTALESS_MCP_TRANSPORT=http` starts a stateless `StreamableHTTPServerTransport` on `/mcp` where each request carries `Authorization: Bearer <token>` — tokens issued once from `POST /admin/api/mcp-agents` (rotated/revokeable per agent, sha256-only in the new `mcp_agent_tokens` table), so two tokens are two identities with separate permissions and audit. The previously-missing `@modelcontextprotocol/sdk` dependency is now a real dependency of `packages/mcp-server` (the server could not even start before). Honest remaining gap: stdio (Claude Desktop/Cursor local) still resolves one fixed env identity per process (Option A — the SDK exposes no per-call `authInfo` over `StdioServerTransport`), and the HTTP mechanism is a symmetric bearer secret, not Ed25519 per-request verification like Web Bot Auth.
- `[x]` AT Protocol identity — the stub is now a real **optional, symbiotic bridge** with APW: `packages/identity-atproto/src/` has `handle.ts` (spec syntax verbatim, with the deliberate two-level split `parseHandle` = syntax only vs `resolvableHandle` = + reserved TLDs, since the spec says reserved TLDs fail *resolution*, not syntax), `resolve.ts` (bidirectional handle<->DID over TXT-preferred/HTTPS fallback, `did:plc`/`did:web` verified against the claimed handle, signing key + PDS), `link.ts` (three link confidences: `also_known_as`, `self`, `subdomain`) and `reputation.ts` (`buildAtprotoReputation()`: AT identity + site W (local if this instance *is* the site, else the remote `/trust/<siteId>` **public-only** projection) + user R from `reader_conduct` for `did:apw:<handle>`, honest `no_data` instead of a made-up zero, 5 min/1 min cache, every dependency injectable). Public surface: `GET /trust/atproto/:handle` (400 syntax/reserved, 404 unresolvable/link mismatch, 502 upstream down, CORS `*`, short cache, never 500 — join failures degrade inside the 200). Symbiotic side: admin CRUD `GET/POST/DELETE /admin/api/apw-atproto-links` (admin role server-side, `resolvableHandle` so a handle that can never resolve is never stored, idempotent) publishes `alsoKnownAs: ["at://<handle>"]` in `/.well-known/did.json` — with **zero links the document is byte-identical to the historical format**, and a corrupt `alsoKnownAs` invalidates the whole document; `site_atproto_links` store (D1/SQLite/InMemory, `schema-additions/atproto-links.sql`, master `schema.sql` regenerated, joined `REQUIRED_TABLES`). ~130 new tests across 7 suites (`atproto-handle`/`resolve`/`link`/`links-store`/`reputation`, `admin-atproto-links-endpoint`, `trust-atproto-endpoint`) plus `alsoKnownAs` cases in `apw-identity.test.ts`. Honest limits in `docs/architecture/identity-atproto.md`: resolution depends on third parties (DNS/plc.directory), discovery is suffix-only (the inverse "which site claims this foreign handle" index is Portaless Index, future), R is host-scoped, remote trust is best-effort; the whitepaper's own vision (own PDS per user, `com.portaless.comment` Lexicons, App View over the firehose) remains unimplemented by design.
- `[x]` Portaless Cloud Images — the cryptographic base is real and usable (`packages/cloud-images/`, v0.0.9.10): **Cloud Image v1 payload** (`contentHash` = sha256 over the sidecar-free bytes, `signedAt` inside the signed data, contemporaneous public SiteTrustScore, `declaredOrigin` human|ai|mixed) + sidecar `{payload, jws}` signed server-side with the site's active Ed25519 key (`typ: apw-image+jws`, JCS via `signSiteJws`; payload tamper-evident by canonical-byte equality; kid must belong to the payload's siteDid, legacy RFC 7638 thumbprint kids accepted) + embedding in a PNG private `pAPW` chunk (insert/replace before IEND, CRC-checked extract, byte-exact strip — the image travels with its own signed metadata) + `cloud_images` store (D1/SQLite/InMemory, unique `content_hash` = dedupe) + `POST /admin/api/cloud-images` (admin role server-side, automatic signing with `getActiveSigningKey`, 404 `site_identity_not_found` without identity, PNG-only, 4 MiB cap) + public serve `GET /images/:imageId` (ETag=contentHash, immutable cache, 304) + local verification `GET /trust/images/:imageId` (against `site_identity` `listKeys`, so it survives key rotation) + standalone verification `POST /trust/images/verify` that resolves the site's keys against the chained APW registry (history including retired keys, did.json fallback) — C2PA without a central authority, never throwing (structured `reason`s, `content_hash_mismatch` when the bytes don't match). ~56 new tests across 7 suites; `schema-additions/cloud-images.sql` joined to master `schema.sql` and `REQUIRED_TABLES`. Honest limits in `docs/architecture/cloud-images.md`: PNG-only transport in v1 (jpeg/webp/gif are in the format but have no sidecar channel), 4 MiB in DB (R2 is the external item), `declaredOrigin` is a declaration, not a detection (moderation of false declarations is future work), no UI, EXIF neither read nor stripped.

---

## External (depends on a third party)

- `[~]` Real pay-per-crawl: test against a Cloudflare zone with Pay Per Crawl + dynamic pricing; confirm minimum price (assumed USD 0.01). Mocks only today.
- `[~]` Deno Deploy and Cloudflare Workers for Platforms: real API calls (tested with mocked `fetch`); the verification path is now one command (`scripts/verify-sandbox-adapters.ts`, Phase 3) and the Cloudflare dispatcher Worker lives in this repo (`infra/cloudflare/dispatcher/`, deployable with wrangler) — what remains is an operator running both against a real account with real credentials. Fastly still contract + TODOs.
- `[ ]` Second real `escrow_report` provider (UI already supports the public-key field).
- `[ ]` External storage integration (Cloudflare R2 candidate) for Cloud Images.
- `[ ]` Natural-language root agent (Nuvid) via external SDK.
- `[ ]` AppPlace and AppLibre: separate projects, official associates (see scope).

---

## Vision and scope decisions (what Portaless will NOT do)

- **Plugin ecosystem**: open catalog, community-regulated. Portaless does not certify plugins; it exposes a public, auditable community `trustScore` and `auditedBy` as informational data. The sandbox limits what a plugin *can* do; it does not certify what it *does*.
- **Trust Layer / Pay per Crawl**: an open protocol, not an insurer. Portaless defines and exposes the protocol (cryptographic agent identification, `allow`/`charge`/`block` policies, public ledger); it never collects money — third parties build settlement layers on top (AppPlace candidates, never core).
- **Site-generation agent**: via an external SDK project, never in the AGPL core (no license mixing, no coupled release cycles).
- **Portaless Index — site discovery**: the local witness aggregator already exists (see production section); the cross-site discovery layer (indexability format reusing the APW TXT, third-party query permission — public / attributed / via settlement, manifest aggregation, provenance layer before treating community votes as sufficient) remains future work. Index is also the first natural reader of the enclaves.
- **One-click onboarding**: third-party-dependent steps (DNS propagation, foreign infrastructure) live in the deferred dashboard checklist, never in a blocking wizard. Remaining internal gaps: visual draft preview of step 1, generic text outside the intent field, Cloudflare Pages OAuth (GitHub only today).
- **Cloud Images + APW as cryptographic SSOT**: the cryptographic base landed in v0.0.9.10 (see the `[x]` item above): image hosting where each image carries the site's Ed25519 signature, a cryptographic existence timestamp, the contemporaneous SiteTrustScore, and a declared-origin flag (`human` | `ai` | `mixed`) — C2PA without a central authority, verifiable against the APW registry, both locally and standalone. The `key_algorithm` column prepares the ML-DSA migration without breaking the chain of custody. Still future: external storage (R2) for large images, moderation model for mis-declared images, EXIF handling, sidecar transport for non-PNG formats, and a management UI.

---

## Roadmap to the official Beta (six phases)

> No dates: this is a single-maintainer project, and putting dates would be a false promise. Each phase carries a **verifiable exit criterion** — advancing to the next depends on a fact, not a feeling, the same standard this ROADMAP already uses with its PRs.

### Phase 0 — Visual identity foundation (precondition for everything else)

**Goal**: one source of truth for color, applied to dashboard and public site alike, with the official palette as the default for new installs.

**Why first**: no later UI phase makes sense if it is built on two color systems that do not talk to each other. Doing it now avoids rework.

1. Extend `DesignTokens` (`skin-engine/tokens.ts`) so `src/styles/global.css` reads the same CSS variables (`--bg`, `--text`, `--accent`, …) instead of its current hardcoded values: the public site becomes governed by the same `skin.json` that today only governs the dashboard. **Honest cost note**: the 12 editor elements render with hardcoded inline `style="..."` (`registry.ts`), not variables — making the public site respond to the skin requires refactoring that `renderHTML` to variables, not just wiring `global.css`.
2. Set `base.json` with the official palette as the default for new installs, with the contrast fix already resolved (text never on pure `#C5D86D` over a light background).
3. Add a real dark mode using `#261C15` as `--bg` and `#F7F7F2` as `--text`.
4. A theme selector in `/admin` that writes the active skin, so "edit later" is a form field, not hand-editing JSON.

**Exit criterion**: change `accent` in one place (`skin.json`) and see it reflected in dashboard, editor, and public site without touching CSS by hand, confirmed by a simple before/after visual regression test.

**Status: shipped.** `global.css` now reads the token variables (`--bg`, `--text`, `--accent`, …) with the official palette as default and aliases the historical `--portaless-*` names to them; the `atomic-elements` `renderHTML` was refactored from hardcoded hex to `var(--token, fallback)` (the honest cost note above); `DEFAULT_TOKENS`/`base.json` carry the official light palette plus a new `accentText` token (the readable-as-text variant of the lime accent — contrast rule enforced); a real dark mode (`#261C15`/`#F7F7F2`) ships via `prefers-color-scheme` + `data-theme`; the active skin persists in a new `site_skin` table served to every page (public site, dashboard, editor) as a stylesheet from `GET /api/site-skin`; and `/admin/appearance` writes it (skin picker + color overrides + per-viewer light/dark toggle). Verified by unit tests plus a Playwright before/after test (`tests/browser/appearance-theme.spec.ts`).

### Phase 0.5 — Close the edit→publish cycle

**Goal**: saving a page in the editor makes it visible to visitors without a terminal.

**Why it exists**: today `PUT /admin/pages/:slug` writes to D1/SQLite, but `/paginas/[slug]` is built only from `src/content/pages/*.json` at build time — nothing serves the DB at runtime, so an edited page is invisible to every visitor until someone runs `npm run publish` (a CLI that only supports self-hosted SQLite and has never been run against a real GitHub account). This gap breaks Phase 1's GIF ("drag an element, see it published") and Phase 5's exit criterion ("a person without the author's help installs Portaless and publishes a site").

1. In the self-host Node runtime (which already serves `dist/` + `functions/`), serve `/paginas/[slug]` dynamically from the `pages` table when the slug exists in the DB — static JSON files keep working as fallback, so nothing breaks for GitHub Pages.
2. A "Publish" button in the editor that runs the dump+build through the runtime (or, minimally, marks the page served-directly so the UI cycle closes without a rebuild).
3. Page manager minimum in the admin UI: list existing pages (`HttpPageStore.list()` already exists, it is just never called), open one by clicking, delete one (`onRequestDelete` does not exist yet in `functions/admin/pages/[slug].js`).

**Status: shipped (self-host + Cloudflare Pages).** `/paginas/[slug]` is now served dynamically from the `pages` table by a new public function (`functions/paginas/[slug].js`): when the slug exists in the DB it renders the stored layout through the atomic-elements engine inside the standard page shell, and when the slug is absent (or the stored layout is corrupt) it calls `context.next()` so the static build in `dist/` keeps working — on GitHub Pages nothing changes, and there the edited page still requires `npm run publish` (the honest static-hosting limit, documented in the CHANGELOG). The editor's save button is now **Publicar** and, after a successful save, shows a "Ver página pública ↗" link straight to `/paginas/<slug>` — closing the edit→publish cycle in the UI. A minimum page manager landed at `/admin/pages`: it lists every page with its title (from the extended `GET /admin/api/pages`), opens one in the editor on click, and deletes it via a new `DELETE /admin/pages/:slug` (session + `canWrite`, `404 {removed:false}` when nothing was there). The list endpoint lives under `/admin/api/` rather than `/admin/pages/` because a Cloudflare Pages Function shadows the static HTML at the same path. Verified by unit tests (route hit/miss/corrupt/traversal, delete 401/403/200/404, title listing), a self-host e2e test proving the DB wins over the static build and that deleting a row re-exposes the static page, and a Playwright spec walking the full cycle (publish → public URL → edit → public URL updates without rebuild → manager delete → public URL 404s).

**Exit criterion**: a person edits a page in `/admin/editor`, clicks save/publish, opens the public URL in a new tab, and sees the change — on self-host, with no terminal open.

### Phase 1 — Visual evidence of the product (cheapest, highest impact)

**Goal**: someone arriving at the repository for the first time can see, in 10 seconds and without cloning or running anything, what Portaless is.

**Why it matters this much**: with ~170 commits and serious architecture, the repo has zero screenshots. This is the lowest-cost, highest-return gap in the whole audit — it requires no new code, only showing what already exists.

1. A public demo instance (GitHub Pages or Cloudflare Pages, both already supported) with real example content: a blog, a link-in-bio page using the 4 existing elements (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`), and a visible `/trust/:siteId`.
2. Real screenshots (not mockups) of the dashboard, the editor with drag-and-drop, and `/trust/:siteId` showing the SiteTrustScore, inserted in the README above the Features table.
3. A short GIF (10–15 s) of the editor in action: dragging an element, seeing it published.
4. Update the README with the official palette applied to the repository's own badges/shields, as the first public demonstration of the brand.

**Status: shipped.** New example content `src/content/pages/link-in-bio.json` (all 4 link-in-bio elements: `ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`) plus the existing blog post give the demo real pages. New `scripts/capture-screenshots.mjs` boots the real product (browser-test server: real `functions/`, real `dist/`, SQLite) and captures six real screenshots into `docs/screenshots/` — public home, link-in-bio, blog, admin dashboard, the visual editor with the page loaded, and `/trust/default` — plus a 10.8 s GIF of the whole cycle (drag a Button into the canvas → *Publicar* → open the public URL and see it live). The README now opens with a "See Portaless in action" gallery above the Features table and its badges carry the official palette (`#261C15` ink labels with `#5A6B24`/`#F05D23`/`#6E6653` messages). `.github/workflows/deploy-pages.yml` builds the static demo (`PORTALESS_BASE_PATH=/portaless/`, verified) and deploys it on every push to `main`; the live instance is at **https://geroiloyola.github.io/portaless/** (the lockfile had to be synced and the workflow uses `npm install` like `ci.yml`, because `package.json` gets edited via API without regenerating the lockfile on `main`). Honest limits: GitHub Pages runs no `functions/`, so the public demo shows the static site only (home, blog, example pages); admin, login, and the dynamic `/trust/:siteId` need self-host or Cloudflare Pages — the screenshots are of the real self-host runtime. Capturing the screenshots surfaced and fixed four real product bugs (all verified by tests or re-capture): (a) `/admin/editor` rendered without its editor chrome — the 3-column shell CSS lived only inline in the standalone demo; (b) the APW identity banner and the SiteTrustScore source panels were dark-on-dark after Phase 0 (they kept dark backgrounds but inherited the light theme's ink text); (c) `/trust/:siteId` returned raw JSON to browsers — the Function shadowed the UI and `getStaticPaths()=[]` meant no HTML existed at all; fixed with a single static shell at `/trust/` served by the Function via `env.ASSETS` content negotiation (`Accept: text/html` → UI, otherwise JSON), covered by 4 new unit tests; (d) the trust page's styles were Astro-scoped but its content is built with `document.createElement`, so rows and badges were unstyled.

**Exit criterion**: the README can be understood visually without reading a single line of text, scrolling only through the images.

### Phase 2 — Competitive visual catalog

**Goal**: go from an MVP catalog (12 elements, 4 skins) to one that sustains real comparisons with site-building tools — not with all of WordPress yet.

**Why in this position**: before this phase it makes no sense to invest in more elements — they would be built on a fragmented token system (Phase 0) and nobody would see them (Phase 1).

1. Elements missing from any basic visual builder: Video (embed), FAQ/Accordion, Testimonial, Form (simple contact), Gallery. Takes the catalog from 12 to ~17, covering the use cases that today force hand-editing HTML. **The contact form matters double**: the wizard's own templates generate "Contáctanus" buttons pointing at a `#contacto` anchor that exists nowhere.
2. At least 2 new skins aimed at the use cases the ROADMAP already identifies as "where Portaless shines today": professional portfolio and launch microsite. Reuses the existing skin-engine, no new architecture work.
3. Starting templates (not just empty skins): 3–4 complete, editable example sites on first `npm run dev`, so "starting from scratch" is not a blank page.
4. Editor polish: hover states, visual feedback while dragging, alignment guides — the mechanism (`drag-drop.ts`) works, but the experience has not been documented as tested by a real non-technical user. **This includes the page manager from Phase 0.5**: the exit criterion below is unreachable if the user cannot open a second page without typing its URL.

**Exit criterion**: a person with no coding knowledge builds a page in a single session (under 30 minutes), unaided, using only the visual editor — proven with a real recorded session, not an assumption.

**Status: shipped (code), exit criterion pending a real recorded session.** (1) The five elements landed in the registry (`Video` with YouTube/Vimeo parsing into youtube-nocookie/player.vimeo iframes and an honest placeholder for unrecognized URLs; `FAQ` as native `<details>/<summary>` — zero JS, keyboard accessible — parsed from a "Pregunta :: Respuesta" textarea; `Testimonial`; `Form` posting to a user-configured endpoint like Formspree/Basin, which renders an explanation instead of inventing a destination when unset; `Gallery` from a one-URL-per-line textarea) — catalog 12 → 17, all panel-editable without array machinery. The wizard's "Contáctanos" `#contacto` dead anchor is now closed: the `portfolio` and `landing` templates include a `Form` with `anchorId: "contacto"`. The MCP `list_page_components` tool and the palette carry the new types; `tests/unit/atomic-elements-new-elements.test.ts` (16 tests: URL parsing, textarea formats, XSS escaping, honest placeholders) + the palette-wide skin-token sweep cover them. (2) Two new skins — `portafolio` (softer sage accent, smaller radius, content-first dashboard) and `lanzamiento` (brand-orange accent with lima as secondary, compact density) — extend the existing engine, selectable from `/admin/appearance` with hints, resolution covered by tests. (3) Three complete starting templates shipped as static example sites (`/paginas/portafolio`, `/paginas/lanzamiento`, `/paginas/servicios`), built from the new elements, editable in the editor like any page — real content instead of a blank canvas. (4) Editor polish: a live insertion indicator (`.ae-drop-indicator`) computed on every `dragover` shows exactly where the element will land; the old `dragleave` flicker (border clearing when passing over a child block) is fixed with a `relatedTarget` containment check; the toolbar gained a "📁 Mis páginas" link back to the page manager, closing the multi-page loop (manager ↔ editor) without typing URLs. Honest limits: the alignment-guides sub-item is delivered as the insertion line, not full geometric snapping (that would need canvas coordinate mapping not yet justified); the exit criterion needs a real recorded session with a non-technical user — the code paths exist (drag from palette → drop indicator → edit props → Publicar → manager) but the session itself has not happened.

### Phase 3 — Hardening for real production

**Goal**: close the security and reliability gaps the ROADMAP itself lists as pending, before inviting the first real external users.

**Why in this position, and not earlier**: they are necessary fixes, but investing here before having visual evidence (Phase 1) would repeat the pattern that produced the current imbalance: more technical depth, zero users to benefit from it.

1. Real verification of the Cloudflare Workers for Platforms and Deno Deploy adapters against a real account (today unverified, per this ROADMAP's External section).
2. Deployment of the Cloudflare "dispatcher" Worker, the pending external infrastructure blocking production sandboxing end to end.
3. Sustain the test coverage floors (`68 lines / 67 statements / 66 functions / 65 branches`, measured baseline already above them) and raise coverage toward ~80% in newly added areas, never lowering the floors. *(The original "raise from 40–46% to 60–70%" item is already closed: the project currently runs 1115+ tests at ~74/71/74/75 measured.)*
4. Resolve the documented bus-factor risk — not technically (code cannot fix it), but with an explicit decision: define whether a second maintainer with real merge permissions is sought **before** opening the Beta to the external public. A project with a single human point of failure should not invite third-party production data without that minimal safeguard, in honesty with whoever trusts it.
5. A minimal external security review (it can be informal: a second pair of eyes outside the author) of the authentication flow and the plugin sandbox — the two highest-damage surfaces if they fail.

**Exit criterion**: CI green in a sustained way (not a snapshot), coverage floors held, and at least one person other than the author with real capacity to review or merge code.

**Status: partially shipped from the repo; the account-dependent items need the operator.** (1) Real verification of the edge adapters is now **one command** instead of an open TODO: new `scripts/verify-sandbox-adapters.ts` runs a real upload→invoke→output cycle against Cloudflare Workers for Platforms and/or Deno Deploy when `PORTALESS_CLOUDFLARE_*` / `PORTALESS_DENO_*` credentials are present, and exits honestly (skip + instructions, exit 0) when they are not — the actual run against real accounts remains the operator's step (no test credentials exist in this environment or in CI). (2) The Cloudflare **dispatcher Worker is now real, deployable code**: `infra/cloudflare/dispatcher/` (worker + wrangler config + README with the exact `wrangler dispatch namespace create` / `secret put` / `deploy` sequence); it is fail-closed on a shared `DISPATCH_TOKEN` (new optional `dispatcherToken` config on the adapter, sent as `x-portaless-dispatch-token`; covered by adapter tests) and validates script names against the adapter's sanitization pattern — deploying it against the real account is again the operator's step. (3) Coverage: floors held and a batch of pure-logic gaps closed — `EditorHistory` (undo/redo, deep-clone, the 100-entry cap), `manifest-with-identity`, `LocalManifestSource`, `D1PasswordResetStore` (against real SQLite via the D1 fake), and the `password-reset/confirm` endpoint (full cycle against real SQLite) — plus a real robustness fix surfaced by writing those tests: `validateManifest` threw a TypeError on a manifest missing `requestedCapabilities`, which would have crashed `LocalManifestSource.loadAll()` entirely (one bad manifest took down the whole registry load); it now fails as a validation error. (4) The **bus-factor decision is documented and pending** in [`SECURITY.md`](./SECURITY.md) (three options written out; the author must choose and record it — code cannot fix this). (5) The **external security review is now actionable**: new [`docs/security-review-guide.md`](./docs/security-review-guide.md) maps the two highest-damage surfaces (auth flow, plugin sandbox) file-by-file with attack ideas and the exact test commands, so a second pair of eyes needs no onboarding beyond that document. Exit criterion still open: the sustained-CI snapshot is green (144 files / 1213 tests), but "sustained" is a time property, and the second-reviewer item is exactly the bus-factor decision above.

### Phase 4 — A second real implementer of APW

**Goal**: APW stops being a protocol with a single implementation — the minimal condition to aspire to the reference level.

**Why the hardest and most important phase**: no amount of additional code in this repo solves this. It is solved by getting someone external, without close coordination with the author, to read only `APW-SPEC-v1.3.md` and `APW-VECTORS-v1.3.md` and build an independent implementation that verifies against the same vectors.

1. A minimal starter kit for external implementers: the test vectors already exist (`APW-VECTORS-v1.3.md`); what's missing is a "how to implement APW in your stack" README aimed at someone who never saw Portaless's code, with pseudocode or a non-TypeScript language, to prove the spec is portable and not a description of the existing code.
2. Publish the simplest possible use case (resolving `did:apw` and verifying a manifest) as a standalone library, separate from Portaless's monorepo, in its own npm package (`apw-resolver` already lives as a package; the step is publishing it independently, documented as "does not require the rest of Portaless").
3. Actively seek 1–2 kindred projects or communities (independent media, thematic wiki networks — the exact use cases spec v1.0 already identified in its section 11) and propose they implement APW on their own stack, with direct support from the author.
4. Document publicly the change-proposal process for the spec (already present in v1.3's License and governance section: errata → version → proposals) with a real, visible channel to receive them — today that governance is described but there is no active external input channel.
5. **Optional did:web-compatible publication (Path A, recommended)**: keep the `_apw.<domain>` DNS TXT record as the root of the trust chain — a stronger root than an HTTPS file because it requires DNS control, not just hosting — and additionally publish an optional `/.well-known/did.json` in **did:web** format whose `service` entry points at the already DNS-anchored log. Any existing did:web resolver reads the identity unchanged; a client that does not know APW ignores the service it does not understand; a client that does know APW follows the service and fetches the trust chain. **One erratum is required before this ships**: define the subject mapping — attestations and history reference `did:apw:<domain>` subjects, so the erratum must state that `did:web:<domain>` publishing the same key and declaring the `did:apw:<domain>` log via `service` is recognized as the same subject for verification. Without that rule, "compatible" is half-true.

**Exit criterion**: at least one domain that is not the author's publishes a valid `_apw.*` record, verifiable with `resolveApwManifest()`, built with implementation code the author did not write.

### Phase 5 — Index as a real aggregator, public Beta

**Goal**: Index starts behaving like a real network, not a single-operator script, and the project opens its first official Beta with onboarding proven by real non-technical people.

**Why last**: Index aggregating witnesses of a single operator is not a network, it is a database. It needs Phase 4 to have produced more than one real instance first — aggregating witnesses of a single author would simulate a network, not build one.

1. Witness weight calibration (A.4.4-style, already designed mathematically in the spec but not implemented for Index, per the code's own comments in `witness-index.ts`).
2. Minimal inter-node synchronization between Index instances (gossip or periodic pull between two or more Index deployments, currently nonexistent per the code).
3. The one-click onboarding wizard (already designed in this ROADMAP) tested with at least 3–5 people without a technical profile, with adjustments based on those sessions, not on design assumptions.
4. Documentation for a non-technical audience: not another 114 KB `ROADMAP.md`, but a short "install your site in 10 minutes" guide with screenshots (reusing Phase 1 material).
5. Public Beta announcement with the official palette applied end to end, the Phase 1 public demo as the first impression, and an explicit honesty note about what is ready and what is not — the same transparency standard the project already uses in its "Real status by module", now applied to whoever discovers it for the first time, not only to whoever reads the code.

**Exit criterion (and close of this roadmap)**: a person outside the project, without the author's direct help, installs Portaless, publishes a site with APW identity, and that site appears correctly in at least one Index node that is not the author's.

### Beta readiness checklist

One list, so progress does not depend on re-reading the six phases:

- [x] One token system governs dashboard and public site alike
- [x] Official palette (`#C5D86D` / `#261C15` with `#F7F7F2`, `#E4E6C3`, `#F05D23` gradients) applied by default, editable per skin
- [x] Editing a page and seeing it published works from the UI, no terminal
- [x] The README shows real screenshots of the product, not only text
- [x] A public demo instance is browsable without installing anything
- [x] The element catalog covers basic content-site use cases (video, FAQ, contact form, gallery)
- [ ] CI green in a sustained way, coverage floors held in the range the ROADMAP set for itself
- [ ] At least one person other than the author with real capacity to review or merge code
- [ ] At least one external domain (not the author's) publishes valid APW identity
- [ ] Portaless Index aggregates witnesses of more than one operator, with calibrated weights
- [ ] The onboarding wizard was tested with real non-technical people
- [ ] "First steps" documentation exists for someone who does not read TypeScript

---

## Open manual tasks

1. GitHub Settings: `main` with required status checks (`build`, full test suite) before merging.
2. Grant `network:fetch` to `commerce-plugin` in `/admin/permissions` after updates (catalog shows empty without it — correct behavior since PR #55).
3. Reconnect the wizard step-2 GitHub App: credentials saved before PR #61 have owner `"undefined"`.
4. Run the full onboarding flow against a real GitHub account and a real domain with the `_apw.` TXT published (v2 TXT with `k` and `h`, `did.json`, `apw-log.json`, `resolveApwHistory`).
5. Register an escrow provider with a public key and send a signed report.
6. Test Pay Per Crawl against a real Cloudflare zone.
7. Deploy to real Railway and Render following `docs/self-hosting-verification.md`.
8. Manually test `/admin/security`, `/admin/wizard/rotate-identity`, and the step-4 rotation link.
9. Review PR #56's `build` job log (19s vs 1.5–3 min) and confirm it ran everything.
10. When regenerating `package-lock.json` on Windows, use recent npm (`npx npm@11 install --package-lock-only`): npm 11.6 skipped optional deps and broke `npm ci` on Linux.
