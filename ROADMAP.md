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
- `[x]` MCP server: 7 real tools over real D1/SQLite stores. Known limit: agent identity resolved once per process (`MCP_AGENT_KEY`), not per invocation.
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
- `[ ]` Raise Full Tests coverage floors from 45/44/46/40 toward 60–70%, never lowering them.
- `[ ]` MCP server: per-invocation agent identity (today per-process; active security risk documented in `AGENT.md`).
- `[ ]` AT Protocol identity (`packages/identity-atproto/` is still an empty stub).
- `[ ]` Portaless Cloud Images — see scope section below.

---

## External (depends on a third party)

- `[~]` Real pay-per-crawl: test against a Cloudflare zone with Pay Per Crawl + dynamic pricing; confirm minimum price (assumed USD 0.01). Mocks only today.
- `[~]` Deno Deploy and Cloudflare Workers for Platforms: real API calls (tested with mocked `fetch`); need real account credentials. Cloudflare additionally needs the per-namespace "dispatcher" Worker (infrastructure outside this repo). Fastly still contract + TODOs.
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
- **Cloud Images + APW as cryptographic SSOT**: future extension — image hosting where each image carries the site's Ed25519 signature, a cryptographic existence timestamp, the contemporaneous SiteTrustScore, and a declared-origin flag (`human` | `ai` | `mixed`) — C2PA without a central authority, verifiable against the APW registry. The `key_algorithm` column already prepares the ML-DSA migration without breaking the chain of custody. Not even a stub today; the core pieces that enable it (Web Bot Auth, SiteTrustScore, settlement, crypto-agility) exist. Tasks to start it: specify the APW image-metadata format, define embedding (EXIF / PNG chunk / sidecar), evaluate R2, upload endpoint with automatic signing, public verification endpoint, moderation model for mis-declared images.

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
