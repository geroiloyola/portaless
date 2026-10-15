# AGENT.md — Context for AI agents working on Portaless

> Canonical, always-current version. The Spanish archive with the same content is [`AGENT_es.md`](./AGENT_es.md) (kept intact; English wins on any discrepancy).

This file exists so any AI agent (Claude, GPT, Cursor, whatever) has immediate project context without reading the whole commit history, the full whitepaper, or guessing each module's real state. Read it first, always.

## What Portaless is, in one sentence

A lightweight, open-source, Astro-based CMS designed to deploy without paid hosting (GitHub Pages / Cloudflare Pages), with optional modules for commerce, AI-agent identification, plugin sandboxing, and a modular dashboard — explicitly designed not to repeat WordPress's structural problems (unrestricted plugins, complex theming, no AI-scraping control). The core is licensed AGPL-3.0 (`LICENSE`); the Protocol APW specification (`docs/protocol-apw/`) is published separately under CC BY 4.0 — reimplementation creates no AGPL obligations, see "Licencia y gobernanza" in `APW-SPEC-v1.3.md`; the Plugin SDK is licensed separately under MIT so third-party plugins are not restricted (`packages/plugin-sdk`, shipped v0.1.0) — see `docs/architecture/licensing-boundaries.md` for the exact boundary.

## Golden rule before touching any code

**Never assume something works because the file exists.** This project explicitly documents, in the code and in `ROADMAP.md`, what is truly implemented and what is a skeleton with `TODO`s. Before building on a module, verify its real state in the table below.

## Real state map per module (see `ROADMAP.md` for the living detail)

| Module | Location | Real state |
|---|---|---|
| Content engine (Astro) | `src/`, repo root (NOT `packages/core/` — see `docs/architecture/REPO_STRUCTURE_MAP.md`) | ✅ Functional |
| Commerce (Medusa/Mercur) | `src/commerce/` | ✅ Functional (catalog read-only, no own checkout) |
| Atomic Elements (visual editor) | `packages/atomic-elements/` | ✅ Functional, with undo/redo and visual column nesting. `ElementType` includes the original 8 types + 4 more for "link in bio" pages (`LinkList`, `SocialIcons`, `ProfileHeader`, `StoreBlock`), with real `ElementDefinition` in `elementRegistry`/`elementPalette` |
| Dashboard + Skin System | `packages/dashboard/` | ✅ Functional |
| Authentication / user roles | `packages/auth/` | ✅ Functional: user/password, admin/viewer roles, MFA/TOTP, password recovery, OAuth/SSO (`AuthService`). Server-side guard confirmed in the dashboard. Base for email step-up also in place (`EmailSender` webhook/dev/unavailable + OTP challenge store + `requestEmailStepUpCode`/`verifyEmailStepUpCode`); sensitive endpoints still verify with password + TOTP until the wiring is reviewed. |
| Permissions Center | `packages/permissions/` | ✅ Functional UI with real persistence (D1PermissionStore/SqlitePermissionStore), endpoints wired |
| Trust Layer (Web Bot Auth) | `packages/trust-layer/` | ✅ Resolves key directories AND validates cryptographic signatures (RFC 9421: Ed25519 via WebCrypto and experimental ML-DSA-44/65/87 via `@noble/post-quantum`, in both the middleware verifier and the SiteTrustScore `agent` source — shared implementation in `webbotauth/ml-dsa.ts`), with directory cache and nonce-uniqueness replay protection shared across instances via D1/SQLite (`webbotauth_nonces` table, in-memory fallback for single-process dev) |
| Plugin sandboxing | `packages/plugin-sandbox/` | ✅ Self-hosted `isolated-vm` adapter runs real code, with all 12/12 plugin catalog capabilities bridged via real `ivm.Reference` and a reusable isolate pool (non-plugin catalog capabilities — `billing:pay-per-crawl`, `trust:read-governance-bypass` — are not sandbox capabilities). Active protection against known CVE (GHSA-864f-rcv7-6rh4). Production wiring: `runPluginInProduction()` + `POST /admin/api/plugins/run` build the runtime via `createSandboxRuntime()` with edge adapters from env and the shared HTTP bridge token store; real Cloudflare/Deno edge runs still need external credentials (mocked `fetch` only) |
| Commerce as a sandboxed plugin | `packages/commerce-plugin/` | ✅ Migrated to a real plugin running inside the sandbox; no longer a reference-only manifest |
| Public traceability ledger | `packages/trust-layer/src/ledger` | ✅ Real persistence; both write and public read paths wired |
| MCP server | `packages/mcp-server/` | ✅ Connected end-to-end: `createPortalessMcpServer()` (`src/server.ts`) registers the 7 real tools (`create_page`, `update_page`, `list_page_components`, `query_usage_log`, `list_installed_plugins`, `grant_capability`, `revoke_permission`) over real stores; `src/index.ts` builds the real stores and supports two transports (`PORTALESS_MCP_TRANSPORT`): **stdio (default) with per-process env identity (Option A)** and **HTTP (`=http`) with per-invocation agent identity (Option B)** — on HTTP, each request carries `Authorization: Bearer <token>` (issued once from `POST /admin/api/mcp-agents`, stored sha256-only in `mcp_agent_tokens`, rotatable/revocable per agent), verified by `createBearerTokenAgentIdentityResolver` on **every** tool invocation, so two tokens are two identities with separate permissions and audit. Honest remaining gap: over stdio the MCP SDK still does not expose per-call `authInfo`, so the local-stdio process remains one fixed env agent (`MCP_AGENT_KEY` required) — and the HTTP mechanism is a symmetric bearer secret, not Ed25519 per-request verification like Web Bot Auth. See `docs/architecture/mcp-agents.md`. |
| AT Protocol identity | `packages/identity-atproto/` | ✅ Optional symbiotic bridge with APW: AT handle<->DID resolution per spec (TXT/HTTPS, `did:plc`/`did:web`, signing key + PDS), link confidences (`also_known_as`/`self`/`subdomain`), `buildAtprotoReputation()` join behind public `GET /trust/atproto/:handle`, and admin-managed `alsoKnownAs` links in `/.well-known/did.json`. Whitepaper's own vision (own PDS, comment Lexicons, App View) still unimplemented on purpose — `docs/architecture/identity-atproto.md`. |
| Cloud Images (APW as cryptographic SSOT) | `packages/cloud-images/` | ✅ Cryptographic base (v0.0.9.10): Cloud Image v1 payload (contentHash, signedAt inside the signed data, contemporaneous public SiteTrustScore, declaredOrigin human\|ai\|mixed), sidecar `{payload, jws}` signed server-side with the site's active Ed25519 key (`typ: apw-image+jws`, JCS; kid must belong to the payload's siteDid), embedding in a PNG private `pAPW` chunk, `cloud_images` store (D1/SQLite/InMemory, unique content_hash = dedupe), admin upload with automatic signing (`POST /admin/api/cloud-images`, 404 without site identity), immutable public serve (`GET /images/:imageId`), local verification (`GET /trust/images/:imageId`, survives key rotation via `listKeys`) and standalone verification against the chained APW registry (`POST /trust/images/verify` — retired keys included, never throws). Honest limits: PNG-only transport, 4 MiB in DB (R2 external), declaredOrigin is a declaration not a detection (moderation future), no UI, EXIF neither read nor stripped — `docs/architecture/cloud-images.md`. |
| Protocol APW resolver | `packages/apw-resolver/` | ✅ Fully implemented end-to-end (DNS-over-HTTPS resolution, `did:apw` with rotation, DNS-anchored chained history, external witnesses §5.7, Portaless Index local witness aggregator). This row previously said "empty stub" — that was false. |
| Plugin SDK | `packages/plugin-sdk/` | ✅ Shipped v0.1.0 (MIT): capability catalog, `validateManifest` and the typed sandbox contract; the catalog/logic parity with the core is pinned by `tests/unit/plugin-sdk-parity.test.ts`. The HTTP installer and the real capability backends remain Phase 11.2 |

## Where every important document lives

- [`ROADMAP.md`](./ROADMAP.md) — prioritized checklist of what is missing. **Read this before proposing a new feature.** (Spanish long-form archive: `ROADMAP_es.md`.)
- [`CHANGELOG.md`](./CHANGELOG.md) — real history, version by version. (Spanish archive through the doc restructuring: `CHANGELOG_es.md`.)
- [`SECURITY.md`](./SECURITY.md) — known and active vulnerabilities (includes the real `isolated-vm` CVE, GHSA-864f-rcv7-6rh4).
- [`docs/README.md`](./docs/README.md) — index of the whole documentation tree.
- [`docs/api/`](./docs/api/) — integrator guide for Portaless HTTP APIs (public well-known endpoints, admin endpoints, verification recipes).
- `docs/architecture/REPO_STRUCTURE_MAP.md` — why the real repo structure differs from the original proposal, and where each thing actually is.
- `docs/architecture/licensing-boundaries.md` — exact boundary between the AGPL-3.0 core, the MIT Plugin SDK, and third-party projects/plugins.
- `docs/architecture/mcp-agents.md` — original MCP server design. The 7 tools are wired; per-invocation agent identity (Option B) is implemented for the HTTP transport; stdio keeps the documented per-process env identity (Option A, SDK limitation).
- `docs/whitepaper/portaless-whitepaper.md` — full product vision (Spanish; much of it is design, not built code — always cross-check with the status table above).
- `docs/protocol-apw/` — normative APW specification v1.3 (`APW-SPEC-v1.3.md`, English canonical; `APW-SPEC-v1.3_es.md` Spanish archive) + test vectors. `apw-spec.md` there is a historical conceptual summary, not the code's state.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to propose changes.

## Code conventions this project follows strictly

1. **Every new module is optional by default.** Enabling commerce, Trust Layer, or sandboxing must never break the site when the module is off. See the `ENABLE_COMMERCE` / `ENABLE_TRUST_LAYER` pattern in `functions/_middleware.js` and `astro.config.mjs`.
2. **No plugin ever receives more capabilities than explicitly granted.** The rule lives in `packages/plugin-sandbox/src/runtime/sandbox-runtime.ts`: always use what the Permissions Center *granted*, never what the plugin *requested* in its manifest. The same principle applies to the MCP server via `requireCapability()` (`packages/mcp-server/src/permissions/require-capability.ts`) inside each tool — the agent identity checked is resolved **per invocation** on the HTTP transport (Option B) and is the fixed per-process env identity on stdio (Option A).
3. **Every plugin manifest declares atomic capabilities with a human-readable reason.** Full catalog: `packages/plugin-sandbox/src/capabilities/capability-registry.ts`.
4. **Never declare something "implemented" if it has a real integration `TODO` pending.** This project documents limitations honestly over pretending functionality — keep that standard in any code or documentation you add.
5. **All changes go on the single `agentic` branch; never commit directly to `main`.** One working branch for agentic changes; do not create feature branches unless the project owner explicitly instructs it. (Applied exception with explicit instruction: the `mcp-server-sync` and `atomic-elements-design` consolidations went to `main` via the intermediate `fixes-main` branch to review conflicts first.)
6. **The only surface a third-party plugin imports is `packages/plugin-sdk`** (MIT, shipped v0.1.0). No plugin may import core internals directly — all communication goes through the capability bridge (`ivm.Reference` + `hostBridge`).

## Expected agent workflow in this repo

1. Read `ROADMAP.md` to know which priority to attack.
2. Verify the affected module's real state in this file's table — do not trust the folder name.
3. Push changes to the single `agentic` branch (no new branches; convention #5).
4. Implement the change, including a test in `tests/unit/` or `tests/e2e/` if it resolves a `TODO`.
5. Update `CHANGELOG.md` and tick the matching `ROADMAP.md` checkbox if applicable.
6. Open or update the Pull Request from `agentic` to `main` — never merge directly, even with technical permission. The project owner approves manually.

How to verify (the `npx`/`node_modules/.bin` shims are broken under Node 24 in this environment — invoke the real CLIs):

- Unit/e2e: `node node_modules/vitest/vitest.mjs run` (all `*.test.ts` in the repo; `vitest.config.ts` excludes Playwright's `*.spec.ts`).
- Build: `node node_modules/astro/bin/astro.mjs build` (22 pages).
- Manifests: `node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts`.
- Browser (Playwright, real self-host runtime against `dist/`): `npx playwright test` (or `npm run test:browser`). The webServer boots `scripts/browser-test-server.mjs` (auto-builds if `dist/` is missing, seeds an admin + a `did:apw` identity in a temp SQLite under `test-results/browser-e2e/`). Runs serially on purpose (`workers: 1`): the flows mutate shared state.
- There is no typecheck (no tsconfig) — bugs surface through tests, not the compiler. Missing interface methods on store classes are exactly the kind of bug that only a runtime test catches.

## Active security risks any agent must know before touching these modules

- `isolated-vm` (self-hosted sandboxing adapter): versions ≤7.0.0 are vulnerable to RCE (GHSA-864f-rcv7-6rh4). The code already rejects vulnerable versions at instantiation — do not remove that check.
- The Permissions Center and the traceability ledger have real persistence connected — do not treat their data as disposable across deployments.
- The MCP server runs with a FIXED agent identity per process (Option A, see table) — do not assume cryptographic verification of who invokes each tool over stdio. If Option B is ever implemented, update this section and the status table.

## Reference tech stack

Astro 4.x + TypeScript, no heavy UI framework (dashboard panels and Atomic Elements render directly to DOM/HTML, no React/Vue). npm-workspaces monorepo (`packages/*`). Target deployment: GitHub Pages or Cloudflare Pages, no own server for the base use case.
