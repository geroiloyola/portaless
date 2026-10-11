# Changelog

All notable versions of Portaless are documented in this file.
For the real, verified state of each module, always see [`ROADMAP.md`](./ROADMAP.md)
and [`AGENT.md`](./AGENT.md) — this changelog is the history of what was added in
each version, not a guarantee that everything listed is free of `TODO`s.
(The Spanish archive through the October 2026 documentation restructuring is
[`CHANGELOG_es.md`](./CHANGELOG_es.md); from that point on the changelog is
maintained in English only.)

## v0.0.9.10 (unreleased)

### Added

- **ML-DSA (FIPS 204) in the middleware verifier** (ROADMAP): `packages/trust-layer/src/webbotauth/verify.ts` (the one `functions/_middleware.js` runs on every request) now verifies ML-DSA-44/65/87 signatures, not just Ed25519 — until now PQ verification existed only in the SiteTrustScore `agent` source. The operator key directory can publish `kty: "AKP"` keys (`alg: "ML-DSA-44|65|87"`, public key in `pub`, same format the `agent` source already used), and the optional `alg` parameter of `Signature-Input` accepts `ml-dsa-*` case-insensitively; if present it must match the directory key (`algorithm_key_mismatch`), and a key without its material (`x`/`pub`) stays `unsupported_key_type_in_directory`. The implementation is shared: `webbotauth/ml-dsa.ts` is now the single ML-DSA module for both verifiers (`site-trust/web-bot-auth.ts` re-exports it, no duplicate crypto), with `@noble/post-quantum` lazy-loaded so the common Ed25519 path pays nothing and an unloadable library fails explicitly (`ml_dsa_unavailable: …`) instead of silently rejecting every signature. `result.keyAlgorithm` reports the real algorithm used (`ed25519` or `ml-dsa-44/65/87`, lowercase, aligned with `authorized_agents.key_algorithm`). Tests: `webbotauth-verify-ml-dsa.test.ts` (13, real ML-DSA signatures over the RFC 9421 base: per-algorithm round-trips, alg↔key mismatches, tampering, cross-key rejection, nonce replay, directory cache, missing `pub`); the existing 8 `webbotauth-ml-dsa.test.ts` cases pass unchanged through the re-exports. Honest limits unchanged: no independent audit of `@noble/post-quantum`, `kty: "AKP"` is still an IETF draft format, and no verified run against a real external ML-DSA agent yet.
- **Production caller of `createSandboxRuntime()` for edge adapters** (ROADMAP): `packages/plugin-sandbox/src/runtime/production-plugin-runner.ts` (`createProductionAdapterRegistry(env)` + `runPluginInProduction(env, input, deps)`) wires the full production loop in one place: edge adapters configured from env (`PORTALESS_CLOUDFLARE_*` / `PORTALESS_DENO_*`, registered only when their credentials are present), `isolated-vm` as last-resort fallback on Node (skipped in workerd and when the installed version fails the GHSA-864f-rcv7-6rh4 safety check), real Permission Center store with the v0.0.9.30 rule (granted ∩ requested), the shared `CapabilityTokenStore` that validates `/api/internal/capability-bridge`, and per-request `bridgeUrl` (new optional 4th argument of `SandboxRuntime.runPlugin`, previously only the global `PORTALESS_CAPABILITY_BRIDGE_URL`). Exposed as `POST /admin/api/plugins/run` (admin role; only registered+active plugins; code loaded server-side from `PORTALESS_PLUGIN_DIR`, default `packages/plugin-sandbox/examples`, with path-traversal guards; on Cloudflare Pages/workerd — no filesystem — it responds an explicit `503 plugin_source_backend_unavailable`). Until now the only production plugin (`commerce-plugin`) built the `isolated-vm` adapter by hand, so nothing in production exercised the edge/token path. Tests: `production-plugin-runner.test.ts` (12), `admin-plugin-run-endpoint.test.ts` (8), `sandbox-production-runner.test.ts` (e2e, real isolate + real network).
- **External witnesses (ERRATA E-10, spec §5.7)**: `packages/apw-resolver/src/did-apw/witness.ts` (`apw-witness+jws` statements with deterministic `jti`, verification against the witness's key, and fail-closed `head_mismatch` / `equivocation` / `backdated_entry` evaluation), `POST /admin/api/witness/record` (admin role; logs the observation into the witness's own chained history), and `GET /.well-known/apw-witnesses.json` (published statements, paginated). Test vectors V-13 in `APW-VECTORS-v1.3.md`; E-10 integrated into `APW-SPEC-v1.3.md` (new section 5.7).
- **Automated `h` anchoring (E-10)**: `--anchor --domain <d>` mode in `dnslink/cli.mjs` (fetches live `did.json` + `apw-log.json` and prints the ready-to-paste v2 TXT, via `buildSiteManifest`), and a structured `anchor: { status, publishedH, localH, localSeq }` field in `/admin/api/apw-verification-status` with a dashboard checklist line. Pasting the TXT stays manual (no standardized DNS API); the computation does not.
- **Automatic `reader_conduct` emission (E-9/E-10)**: `scoring/reader-conduct-auto.ts` + `scoring/reader-conduct-jti-store.ts` index (table `reader_conduct_jti`, seeded from `att_jws` on migrated databases). The Trust Layer middleware fires it with `context.waitUntil` after each verified access with a candidate `readerDid` (6 h throttle per agent/period; opt-out `APW_AUTO_EMIT_CONDUCT=false`). The step-up admin endpoint remains for backfill and shares the index.
- **Specification license and governance (CC BY 4.0)**: new `Licencia y gobernanza` section in `APW-SPEC-v1.3.md` (standard's license, author and edition, name, neutrality and conformance without Portaless permission, change process: errata → version → proposals). License lines in `ERRATA.md` and `APW-VECTORS-v1.3.md`, a specification row in `docs/architecture/licensing-boundaries.md`, and notes in `README.md` and `docs/protocol-apw/README.md`. The standard's license does not contaminate the AGPL-3.0 code, nor vice versa.
- **Neutral name for section 6**: now **Loyal Trust Protocol (LTP)**, previously "Loyola Trust Protocol" (same acronym, same specification; continuity note in the License and governance section). Affects spec v1.3 and `docs/architecture/site-trust-score.md`; historical documents (v1.0, v1.2, whitepaper) keep the name they were published under, and author credit is preserved in the header and Annex A.
- **Master `schema.sql` regenerated (v0.0.9.31)**: now includes `usage_ledger.reader_did` (ERRATA E-9, already in its package source; the master was behind) and the new `reader_conduct_jti` table (APW spec §6.4, index of already-emitted jtis, DDL in `packages/apw-resolver/schema.sql`). Idempotent regeneration, applied twice in a row against SQLite without errors (25 tables at the time). Existing databases keep receiving both changes on the fly from their stores, without re-applying the file.
- **Per-reader governance bypass (APW spec §6.5, closes E-8)**: the Permissions Center accepts the `reader` subject (the `did:apw:` of a reader) and the new `trust:read-governance-bypass` capability (`packages/permissions/src/reader-bypass.ts` + catalog entry in `capability-registry.ts`; a plugin cannot request it in its manifest). `GET /trust/:siteId` queries the grant and, with an active policy, skips the reputation thresholds via `evaluatePolicy(..., { bypass: true })`. The bypass does not skip APW identity (§6.3) nor validate a corrupt policy, and if the grants store cannot be read, no bypass applies. Managed from `/admin/permissions` (the PUT responds `400 invalid_reader_grant` on a malformed DID or any other capability for a `reader` subject), with a DID form in the Permissions Center.
- **Non-active reader keys accepted within their window (APW spec §6.3)**: `resolveReaderState()` accepts a signature whose fingerprint is not `k` when `isRetiredReaderKeyUsable()` (`packages/apw-resolver/src/scoring/reader-identity.ts`) confirms the key is in the `keys` of a history already verified against `k` and `h`, signed at least one chain entry (its fingerprint or `keyId` as `kid`), and its `[validFrom, validTo + RETIRED_READER_KEY_GRACE_MS]` window (10-minute grace on the verifier side) covers the request moment. Otherwise it stays `apw_unresolvable: key_not_bound_to_apw`, and the success cache TTL clamps to the window close. New optional hook `ReaderResolvers.acceptRetiredKey` (by default fetches the history with `includeEntries` + `includeKeys`); `resolveApwHistory()` now publishes `keys` and each entry's `kid` (`history-resolver.ts`). `reader_conduct` emission still requires `k`: during a rollover the site is read, not scored.
- **Public W-dimension projection (APW spec §6.6, closes E-8 and E-11)**: `GET /trust/:siteId` computes the site's W dimensions from its snapshot with `scoring/site-dimensions.ts` (A.2 category-to-dimension mapping, A.4.1 values — with `escrow_report` 7/2.5/1 — and W-09 derived from A.5) and always publishes them in `projection { dimensions, aggregates, governed }` via `projectTrustView()`. On denial, the projection lives in `public.projection`: `dimensions` with only the public set (W-01, W-04, W-06, W-07, W-09) and `aggregates` with score, count and weight sum of all site dimensions (`governed: "withheld"`); on allow, or with no active policy, all dimensions with `governed: "granted"`. Rows outside the model (`perceived_trustworthiness`, legacy values) do not score, and a calculation failure omits the projection without changing the access decision.
- **Per-dimension visibility override (APW spec A.6 / §6.6)**: `site_trust_read_policies` gains the `public_overrides` column (JSON array of **governed** dimensions; automatic `ALTER TABLE` on existing databases; a corrupt value is ignored, which is the safe direction). The owner can make any governed dimension public without touching the policy: `GET /trust/:siteId` passes it to `projectTrustView()`, so when denying a reader, `public.projection.dimensions` carries the public set **plus** the override while the rest of the governed level stays hidden. `normalizePublicOverrides()` only accepts governed dimensions (the public level cannot be "opened" or invented), sorts and deduplicates them.
- **Portaless Index: local witness aggregator (APW spec §5.7 and section 7)**: `packages/apw-resolver/src/did-apw/witness-index.ts` + `witness-index-store.ts` (tables `witness_observations`, `witness_weights` and `witness_index_subjects`; D1/SQLite/InMemory, created on the fly in existing databases). `POST /admin/api/index/sync` (admin role, no step-up: everything it fetches and verifies is public) pulls from a configured set of up to 20 witnesses, fetches their paginated `/.well-known/apw-witnesses.json`, and applies all four §5.7 verifiers end-to-end to each statement (witness chain verified, `att === sha256(jws)` anchored in **that** chain, signature against the witness's key, deterministic `jti`; plus expected `iss`/`sub` and no self-witness). It stores the latest anchored observation per (subject, witness, seq) — a smaller anchor never overwrites a larger one — evaluates it against the subject's live chain (`head_mismatch` / `equivocation` / `backdated_entry`, 300 s margin), and caches the directory entry with its `status` and a `consensus` weighted by static per-witness weight (default 1.0). The directory is published as a plain, re-verifiable document at `GET /.well-known/apw-index.json` (`{ typ: "apw-index", iss, generatedAt, subjects[] }`) and `GET /admin/api/index/subjects` lists it for the admin. `resolveApwHistory()` now exposes per-entry `entryHash` (the hash witnesses observe). Out of scope, documented in spec §5.7 and §7: A.4.4-style weight calibration, gossip/sync between index nodes, and manifest/SiteTrustScore aggregation from other instances. Tests: `apw-witness-index.test.ts` (17, with real keys and signed statements), `apw-witness-index-store.test.ts` (10) and `apw-index-endpoints.test.ts` (10).

### Fixed

- `scripts/generate-schema.mjs` was behind the master `schema.sql` itself (v0.0.9.4 vs v0.0.9.27): it only knew 4 sources, regeneration would have deleted 17 of the 24 existing tables, and its addendums no longer matched the master. Rewritten with the real 13 sources in order; sections without a package `schema.sql` (password reset, plugins, site trust, allowlists, capability bridge, deployment) now live in `schema-additions/*.sql` as editable sources, so the master is 100% generated again. Regeneration verified by diff: only header notes, `reader_did` and `reader_conduct_jti` change.
- `README.md` linked `./LICENSE` (badge and License section) but the file did not exist in the repository. The official AGPL-3.0 text was added.
- `dnslink/cli.mjs` imported `../manifest.js`, a nonexistent file: the CLI did not run. It now imports `.ts` and runs with `tsx` like the rest of the scripts.
- The Trust Layer middleware did not record `allow`-policy accesses in the ledger: it only saw blocked and charged ones. Free traffic now also feeds the public ledger and `reader_conduct` emission.
- Confirmed that the public-key field in `/admin/authorized-escrow-providers` **was already implemented** (`a1e0a57`, escrow panel PR): the store has `public_key_jwk` + `setPublicKey()` (load, replace and remove without rotating the API key, rejecting JWKs with `d`), the endpoint accepts `publicKeyJwk` on `POST` and has a dedicated `PUT`, the page offers it at creation and in a separate panel with browser+server validation, and `escrow-report.js` requires the key to verify the JWS. The ROADMAP still listed it as pending ("today only via API or CLI") due to outdated information, not a missing feature.
- **`scripts/generate-schema.mjs` destroyed the master schema.sql when run**: the CHANGELOG itself documented a rewrite "with the real 13 sources" that was **never committed** — the script at HEAD was still the v0.0.9.4 one (only 4 packages + addendum), so `npm run generate-schema` regenerated a master with 8 tables and deleted 20 of the 28 (authorization, plugins, site trust, apw-resolver, capability bridge, deployment). Rewritten with the real 13 sections in order (5 package `schema.sql` + 8 `schema-additions/*.sql`; `settlement-activations.sql` stays out on purpose, as the header already said), the master's NOTES block now lives inside the generator, and regeneration was verified: 28/28 identical tables, clean SQLite apply, and a diff against the committed master limited to comments. Two real desynchronizations the rewrite had been papering over were also closed: `reader_conduct_jti` existed in the master but had **never reached** `packages/apw-resolver/schema.sql` despite the CHANGELOG claiming otherwise (added there, its real source), and the apw-resolver design prose lived only in the master (moved to the package schema).

### Documented

- **R-05 in policies remains off, and the reason is data, not config (spec §6.5, ERRATA E-9)**: `policyDimensions["R-05"]` was left `false` after measurement, not by habit. A subject's R-05 is the calibration of the attestations **it** emitted (A.4.4), but `loadReaderConduct()` only loads what it **received** (drops `iss` equal to the reader's DID), so even a reader with three calibratable, agreeing emitters ends with `R-05 = { score: 4.0, count: 0, weightSum: 0 }`: with `min_r05_weight = 2.0` the policy would reject it and everyone else. Missing: (1) a flow where the reader emits attestations over subjects (today only anonymous community voting by IP, no DID) and (2) a corpus of other emitters on the same (subject, dimension) for A.4.4's leave-one-out consensus — indexes or witnesses (section 7). The blocker is anchored as a regression in `tests/unit/apw-reader-conduct-config.test.ts` (never enable the flag without solving that) and documented in spec §6.5 and §7 and ERRATA E-9.
- **The three `reader_conduct` categories of spec §6.4 still have no rule, blocked by data, not code**: `rate_respected` (R-02), `paid_as_agreed` (R-03) and `redistribution` (R-04) are not emitted because the ledger does not supply their datum. `LedgerConductInput` is literally what `log-writer.ts` writes (`requestsTotal`, `policyViolationsDetected`) and the middleware records `charged: false` on all four paths: `requests_charged` and `revenue_usd` never move, because with Cloudflare Pay Per Crawl (in-band) the origin returns 200 + `crawler-price` and settlement happens out-of-band. Emitting `paid_as_agreed` from there would be inventing the payment. Each one waits on its own prerequisite: a rate in the content policy with its counter, a settlement that reports the outcome, and witnesses or denunciation for what the origin cannot observe. Regression in `tests/unit/apw-reader-conduct-config.test.ts`, detail in `CONDUCT_RULES`, spec §6.4/§7 and ERRATA E-9.

### Changed

- **Documentation restructured for a global audience (October 2026)**: every canonical root and protocol document is now English (`README.md`, `ROADMAP.md`, `AGENT.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/protocol-apw/APW-SPEC-v1.3.md`, `APW-VECTORS-v1.3.md`, `docs/protocol-apw/README.md`); the Spanish originals are preserved intact as `*_es.md` archives (nothing deleted). New integrator guide under [`docs/api/`](./docs/api/) covering the public well-known endpoints (including `/.well-known/apw-index.json`), admin endpoints, and end-to-end verification recipes for third parties connecting to APW / Portaless / Index APIs; new documentation index at [`docs/README.md`](./docs/README.md). Stale accuracy fixes: `AGENT.md` and `REPO_STRUCTURE_MAP.md` no longer call `packages/apw-resolver` or `packages/mcp-server` stubs (both are implemented; only `identity-atproto` remains a stub), `packages/apw-resolver/README.md` was rewritten from "STUB — not implemented" to a real package README, and `docs/protocol-apw/apw-spec.md` now points to v1.3 (was v1.2).

## v0.0.9.9 (unreleased officially, PR #21 open)

### Added

- **Open+closed plugin ecosystem with community `trustScore`** (partial progress): `packages/plugin-sandbox/src/registry/plugin-registry.ts` with the `PluginRegistryStore` interface and the reference `InMemoryPluginRegistryStore`. Tables `plugin_registry` and `plugin_trust_votes` in `schema.sql`. Design inspired by Shopify App Store / WooCommerce.org / Android Play Store: open catalog by default, trust regulated by community vote (1–5), not by Portaless certification.
- **Real internal HTTP endpoint for the `CapabilityHostBridge`**: `functions/api/internal/capability-bridge.js` validates `Authorization: Bearer <PORTALESS_INTERNAL_BRIDGE_TOKEN>`, queries the real `PermissionStore`, and dispatches `content:read`/`content:write` to the real `PageStore` (the remaining 9 capabilities respond with an explicit 501, same `NOT_CONFIGURED` principle as `node-isolated-vm.ts`).
- `ROADMAP.md` reorganized into 3 responsibility categories: Production, Internal in Development, External.

### Fixed

- Confirmed that `layout.title`/`layout.description` in `src/pages/paginas/[slug].astro` no longer need a defensive cast (`PageLayout` declares them correctly) — this roadmap marked it pending due to outdated information, not a real problem.
- Confirmed that `functions/admin/_middleware.js` does expose `context.data.user` (with `session` as an alias) for the server-side permission guard — earlier roadmap versions marked it "pending verification" due to a temporary tooling limitation, not a real bug.
- Type cleanup in `node-isolated-vm.ts`: the local extended type `BaseCapabilityHostBridge & {contentRead, contentWrite}` is removed, now importing `CapabilityHostBridge` directly from `../types`. Cosmetic change, no functional impact.

### Pending to close this line

- Implement `D1PluginRegistryStore`/`SqlitePluginRegistryStore` (only the in-memory version existed). *(Since implemented — see `packages/plugin-sandbox/src/registry/stores/`.)*
- Connect `functions/admin/permissions/index.js` to the real registry instead of the hardcoded catalog (`hello-plugin`, `commerce-plugin`).
- `trustScore` UI in the Permissions Center.
- Add `PORTALESS_INTERNAL_BRIDGE_TOKEN` to `.env.example` and wire the edge adapters' `bridgeUrl` to the new endpoint.

## v0.0.9.7 (PR #19, merged to main)

### Added

- Real D1/SQLite persistence for `PasswordResetStore`: `D1PasswordResetStore` and `SqlitePasswordResetStore`, same pattern as the user/session stores, using the `password_reset_requests` table (present in `schema.sql` since v0.0.9.4).

## v0.0.9.6 (PR #18, merged to main)

### Added

- `contentRead`/`contentWrite` added to `CapabilityHostBridge` in `types.ts`, completing the real-bridge pattern started in v0.0.9.4 for all 12/12 catalog capabilities.

## v0.0.9.5 (PR #16, merged)

### Fixed

- `functions/admin/login.js` now handles the 2FA flow end-to-end: if `result.mfaRequired && result.mfaChallengeToken`, it redirects to `/admin/login-mfa?challenge=<token>`. No behavior change for users without 2FA enabled.
- `ROADMAP.md` updated and reviewed for vendored third-party code to re-license under AGPL-3.0 — no findings in the root tree (does not replace a formal legal audit of npm dependencies).

## v0.0.9.4 (PRs #13 and #15, merged to agentic and then to main via PR #17)

### Added

- **Project licensing**: `LICENSE` replaced with AGPL-3.0 plus a linking exception for the Plugin SDK; `LICENSE-SDK` (MIT) added; `docs/architecture/licensing-boundaries.md` documents the exact boundary between the AGPL-3.0 core, the MIT plugin SDK, and the AppPlace/AppLibre/third-party projects.
- **Password recovery, 2FA, OAuth/SSO**: `AuthService` gains `completeMfaLogin`, `beginTotpEnrollment`, `confirmTotpEnrollment`, `disableTotp`, `requestPasswordReset`, `completePasswordReset`, `loginWithOAuth`. 6 new endpoints/pages, 15 tests.
- **One-command install**: root `schema.sql` generated from each package's `schema.sql` plus the password-reset table; `scripts/setup.mjs` applies the schema and creates the initial admin (`npm run setup`); `scripts/generate-schema.mjs` regenerates the master when a package changes. Cloudflare D1 still uses `wrangler d1 execute` separately (documented, not automated).
- **Real content bridge for plugins**: `content:read`/`content:write` wired into the real-bridge pattern via `ivm.Reference`, completing 12/12 catalog capabilities with real bridges (the prior 9 already had them since v0.0.9).
- `README.md` with new "Recent updates" and "Licensing" sections; license badge updated from MIT to AGPL-3.0; "Real status by module" table updated.
- Root `package.json`: version 0.0.9.4 (was 0.0.5, outdated for several releases); `license` AGPL-3.0-or-later (was MIT); `setup` and `generate-schema` scripts invokable via `npm run`.
- `SECURITY.md` corrects 2 outdated claims: Web Bot Auth has validated Ed25519 signatures since v0.0.9 (it previously said it did not); the Permissions Center and Trust Layer ledger have real persistence since v0.0.9.2/v0.0.9.3 (they previously said data was lost on restart). Notes added about `PasswordResetStore` being in-memory only (fixed in v0.0.9.7) and the license change as a relevant legal note.
- `.env.example` added (did not exist): documents every environment variable, including the OAuth/SSO block.
- `docs/architecture/authentication.md` rewritten to reflect 2FA/TOTP, password recovery, and OAuth/SSO.

## v0.0.9.3 (PR #12, merged to main)

### Added

- Trust Layer ledger exposed via `GET /.well-known/portaless-usage-log.json` (with optional `?period=YYYY-MM`). Public, no session guard, same transparency criterion as `portaless-content-policy.json`. 5 new tests in `tests/unit/usage-log-endpoint.test.ts`.

### Fixed

- Imprecise diagnosis from earlier versions: `functions/_middleware.js` had been calling `recordAgentAccess()` with `createUsageLedgerStore(env)` since v0.0.6 — ledger writes were already connected. What was missing was the public read, solved in this version.
- Inconsistent D1 binding name across factories: `createPageStore` aligned to `env.DB` like the other 3 factories. SQLite path names unified (`PORTALESS_SQLITE_PATH`).

## v0.0.9.2 (PR #11, merged to main)

### Added

- Permissions Center connected to real persistence end-to-end: endpoint `functions/admin/permissions/index.js` (GET snapshot with known-subject seeding + ungranted defaults, PUT grant/revoke with server-side `canWrite(role)==="admin"` guard). UI (`permission-center-ui.ts`) rewritten so the only write path is `onToggle`. New page `src/pages/admin/permissions.astro`. 9 new tests in `tests/unit/admin-permissions-role-check.test.ts`.

### Fixed

- Documents that the "Real Permissions + Trust Layer persistence" line marked `[x]` in v0.0.6 was imprecise: only the D1/SQLite stores had been created, with no endpoint invoking them yet.

## v0.0.9.1 (PR #10, merged to main together with v0.0.9.2)

### Added

- Real integration with the public REST APIs of Cloudflare Workers for Platforms and Deno Deploy (upload/create + invocation). **Not verified end-to-end against a real account** — covered by tests with mocked `fetch`. Deno Deploy maps `network:fetch` to a host allowlist; Cloudflare uploads/updates scripts via PUT with a deterministic `name@version` name.

## v0.0.9 (PRs #8 and #9, merged to agentic and then to main)

### Added

- Real capability bridges in `isolated-vm`: 9 new capabilities (`storage:read/write`, `email:send`, `commerce:read/checkout`, `media:read/write`, `agent:identify`, `site:admin`) cross into the isolate via `ivm.Reference.apply({result:{promise:true}})`, added to the existing `network:fetch` = 10/12 with real bridges.
- Web Bot Auth key-directory cache and nonce-uniqueness verification against replay (`tests/unit/webbotauth-verify.test.ts`).
- Reusable isolate pool for `commerce-plugin`: `poolMaxIsolates` in `NodeIsolatedVmAdapter`, with real Context isolation per execution even when the underlying isolate is reused.
- Drag-and-drop reordering within the same column slot in Atomic Elements: logic extracted to `packages/atomic-elements/src/editor/tree-ops.ts` (pure functions, tested without DOM).
- Real cryptographic verification of Web Bot Auth (RFC 9421, Ed25519).

## v0.0.8 (PRs #6 and #7, merged to agentic and then to main)

### Added

- Native SEO/GEO: `JsonLd` + `SeoHead` imports wired in `src/pages/paginas/[slug].astro`, using the helpers in `src/lib/seo.ts` (`getSiteUrl`, `buildCanonicalUrl`).
- Real page persistence: `D1PageStore` and `SqlitePageStore` in `packages/atomic-elements/src/persistence/stores/`, plus `store-factory.ts`, fulfilling the existing `PageStore` interface (`load`/`save`/`list`) to stay compatible with the client editor's `LocalStoragePageStore`. `GET`/`PUT` in `functions/admin/pages/[slug].js` use `createPageStore(env)` instead of placeholders.
- `canWrite(role)` applied across the dashboard: DOM-level guard + server-side validation in `functions/admin/pages/[slug].js` and `functions/admin/permissions/index.js`.

---

## v0.0.5

### Added

- **`packages/plugin-sandbox/`**: multi-provider plugin sandboxing.
  - `types.ts`: `SandboxAdapter` contract, atomic capabilities (`CapabilityId`), plugin manifest.
  - `capabilities/capability-registry.ts`: catalog of 12 atomic capabilities grouped by category (Content, Network, Commerce, Storage, AI Agents, Administration).
  - `adapters/`: `CloudflareWorkersForPlatformsAdapter`, `DenoDeployAdapter`, `FastlyComputeAdapter`, `NodeIsolatedVmAdapter` (self-hosted) + `AdapterRegistry` to resolve the first available one.
  - `manifest/`: plugin manifest validation and loading.
  - `runtime/sandbox-runtime.ts`: core engine — always uses what the administrator **granted**, never what the plugin **requested**.
  - Documented security warning about the real `isolated-vm` CVE (GHSA-864f-rcv7-6rh4), with a safe-version check in the self-hosted adapter's constructor.
- **`packages/permissions/`**: atomic, iOS/Android-style Permissions Center.
  - `permission-catalog` (via the shared `capability-registry`), `permission-store.ts`, `permission-center-ui.ts`.
  - `public/permissions/index.html`: standalone demo openable directly in the browser.
- **Updated**: `packages/dashboard/src/organisms/registry.ts` — new `PermissionsCenterPanel` organism summarizing high-risk permissions right on the dashboard.

### Notes for this version

- The four sandboxing adapters are skeletons with complete architecture, but without real integration against each provider's API (explicit `TODO`) — do not use as active sandboxing in production yet. Historical note (fixed in v0.0.6): the self-hosted `isolated-vm` adapter started running real code in the next version.
- `InMemoryPermissionStore` does not persist across deployments; for production use a real backend (Git, KV, SQLite). Historical note (fixed in v0.0.9.2): the Permissions Center has real end-to-end persistence since that version.
- The system is deliberately multi-provider: a site can run 100% self-hosted (isolated-vm) without depending on Cloudflare, Deno Deploy, or Fastly.
