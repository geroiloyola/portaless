# AGENT.md — Context for AI agents working on Portaless

> **Routing vs. state.** [`AGENTS.md`](./AGENTS.md) is the entry point that routes an agent (the north-star user story, the "read this, not all of it" table, conventions). This file is the **state** map. On **what exists today**, `ROADMAP.md` wins, then this file; if `AGENTS.md` disagrees with either, the bug is in `AGENTS.md` (the same tie-break `VISION.md`/`ROADMAP.md` uses for direction vs. state).

> Canonical, always-current version. The Spanish archive with the same content is [`AGENT_es.md`](./AGENT_es.md) (kept intact; English wins on any discrepancy).

This file exists so any AI agent (Claude, GPT, Cursor, whatever) has immediate project context without reading the whole commit history, the full whitepaper, or guessing each module's real state. Read it first, always.

## What Portaless is, in one sentence

A lightweight, open-source, Astro-based CMS designed to deploy without paid hosting (GitHub Pages / Cloudflare Pages), with optional modules for commerce, AI-agent identification, plugin sandboxing, and a modular dashboard — explicitly designed not to repeat WordPress's structural problems (unrestricted plugins, complex theming, no AI-scraping control). The core is licensed AGPL-3.0 (`LICENSE`); the Protocol APW specification (`docs/protocol-apw/`) is published separately under CC BY 4.0 — reimplementation creates no AGPL obligations, see "Licencia y gobernanza" in `APW-SPEC-v1.3.md`; the Plugin SDK is licensed separately under MIT so third-party plugins are not restricted (`packages/plugin-sdk`, shipped v0.1.0) — see `docs/architecture/licensing-boundaries.md` for the exact boundary.

## Golden rule before touching any code

**Naming:** LTP = **Local Trust Protocol** (each node's own policy over verified
evidence); **LTP Stack** = APW + LTP + SVRI + HSVR. Historical expansions belong
only in continuity/archive notes; identifiers, signed bytes and author credit stay intact.

**Never assume something works because the file exists.** This project explicitly documents, in the code and in `ROADMAP.md`, what is truly implemented and what is a skeleton with `TODO`s. Before building on a module, verify its real state in the table below.

## Real state map per module (see `ROADMAP.md` for the living detail)

| Module | Location | Real state |
|---|---|---|
| Content engine (Astro) | `src/`, repo root (NOT `packages/core/` — see `docs/architecture/REPO_STRUCTURE_MAP.md`) | ✅ Functional |
| Commerce (Medusa/Mercur) | `src/commerce/` | ✅ Single configured store catalog read-only, no own checkout or seller/tenant isolation |
| Atomic Elements (visual editor) | `packages/atomic-elements/` | ✅ Functional, with undo/redo and visual column nesting. `ElementType` includes the original 8 types + 4 more for "link in bio" pages (`LinkList`, `SocialIcons`, `ProfileHeader`, `StoreBlock`), with real `ElementDefinition` in `elementRegistry`/`elementPalette` |
| Dashboard + Skin System | `packages/dashboard/` | ✅ Functional |
| Authentication / user roles | `packages/auth/` | ✅ Functional: user/password, admin/viewer roles, MFA/TOTP, password recovery, OAuth/SSO (`AuthService`). Login/reset are persistently rate-limited; reset email supports configured webhook/SMTP, but real relay delivery must be verified per installation. Public registration/invitations remain closed by the invite-only decision. Email step-up primitive exists but sensitive endpoints still verify password + TOTP. |
| Permissions Center | `packages/permissions/` | ✅ Functional UI with real persistence (D1PermissionStore/SqlitePermissionStore), endpoints wired |
| Trust Layer (Web Bot Auth) | `packages/trust-layer/` | ✅ Resolves key directories AND validates cryptographic signatures (RFC 9421: Ed25519 via WebCrypto and experimental ML-DSA-44/65/87 via `@noble/post-quantum`, in both the middleware verifier and the SiteTrustScore `agent` source — shared implementation in `webbotauth/ml-dsa.ts`), with directory cache and nonce-uniqueness replay protection shared across instances via D1/SQLite (`webbotauth_nonces` table, in-memory fallback for single-process dev) |
| Plugin sandboxing | `packages/plugin-sandbox/` | ✅ Self-hosted `isolated-vm` adapter runs real code. The bridge is 12/12 via `ivm.Reference`; 6/12 non-network capabilities have a real host-bridge handler (`content:*`, `storage:*`, `agent:identify`, `email:send`) and `network:fetch` is handled by each sandbox adapter, so 7/12 have a real execution path. The other five (`media:*`, `commerce:*`, `site:admin`) answer `501` by decision. Real Cloudflare/Deno edge runs still need external credentials. |
| Commerce as a sandboxed plugin | `packages/commerce-plugin/` | ✅ Migrated to a real plugin running inside the sandbox; no longer a reference-only manifest |
| Public traceability ledger | `packages/trust-layer/src/ledger` | ✅ Real persistence; both write and public read paths wired |
| MCP server | `packages/mcp-server/` | ✅ `createPortalessMcpServer()` registers 19 tools, including bounded public/private context reads and exact-revision proposal/list/approve tools. Private reads and publication require separate grants. Admin page manager displays proposal diffs and approves exact revision IDs. HTTP has per-invocation bearer identity and host/origin/rate controls; audit events persist append-only in D1/SQLite. `/.well-known/portaless-mcp.json` publishes the secret-free connection profile. See `docs/architecture/mcp-agents.md` and `docs/testing/INTEROPERABILITY.md`. |
| Publication + portability | `packages/deploy-engine/`, `packages/portability/` | ✅ `publication_runs` + `/admin/api/publication` bind runs to an approved snapshot (idempotent publish, stale-retry refusal, tombstone unpublish); `npm run backup` creates checksummed SQLite backups and a CLI restore with single-writer activation. Builds run only on self-hosted Node. |
| OpenAI-compatible provider | `packages/ai-provider/` | ✅ Explicit tested subset: server-side API key, configurable HTTPS base URL/model, chat completions, SSE streaming, non-streaming tool calls, bounded timeout/cancellation and sanitized errors. `GET /admin/api/ai-provider` reports the active profile without the key. External endpoints remain unverified until the contract suite runs against them. Connection guide: `docs/openai-compatible-provider.md`. |
| AT Protocol identity | `packages/identity-atproto/` | ✅ Optional symbiotic bridge with APW: AT handle<->DID resolution per spec (TXT/HTTPS, `did:plc`/`did:web`, signing key + PDS), link confidences (`also_known_as`/`self`/`subdomain`), `buildAtprotoReputation()` join behind public `GET /trust/atproto/:handle`, and admin-managed `alsoKnownAs` links in `/.well-known/did.json`. Whitepaper's own vision (own PDS, comment Lexicons, App View) still unimplemented on purpose — `docs/architecture/identity-atproto.md`. |
| Cloud Images (APW as cryptographic SSOT) | `packages/cloud-images/` | ✅ Cryptographic base (v0.0.9.10): Cloud Image v1 payload (contentHash, signedAt inside the signed data, contemporaneous public SiteTrustScore, declaredOrigin human\|ai\|mixed), sidecar `{payload, jws}` signed server-side with the site's active Ed25519 key (`typ: apw-image+jws`, JCS; kid must belong to the payload's siteDid), embedding in a PNG private `pAPW` chunk, `cloud_images` store (D1/SQLite/InMemory, unique content_hash = dedupe), admin upload with automatic signing (`POST /admin/api/cloud-images`, 404 without site identity), immutable public serve (`GET /images/:imageId`), local verification (`GET /trust/images/:imageId`, survives key rotation via `listKeys`) and standalone verification against the chained APW registry (`POST /trust/images/verify` — retired keys included, never throws). Honest limits: PNG-only transport, 4 MiB in DB (R2 external), declaredOrigin is a declaration not a detection (moderation future), no UI, EXIF neither read nor stripped — `docs/architecture/cloud-images.md`. |
| Protocol APW resolver | `packages/apw-resolver/` | ✅ DNS-over-HTTPS resolution, `did:apw` rotation, DNS-anchored history, witnesses/Index and SVRI v1.0 with published vectors (verificación cruzada, mismo autor; no external review claimed). Public Trust UI shows qualitative SVRI only; detailed counts and HSVR are admin-only. |
| LTP acquisition + verifier (G2/G3) | `packages/ltp-engine/` | 🟡 Bounded identity-only scope: configured HTTPS DoH/TXT and Index acquisition, shared D7 budget/deadline, deterministic offline verification of `apw-identity-proof-v1`. Matches AB-STATIC-01…07 in memory and rejects outer-digest/inner-signature tampering. The real connector rejects special-use CIDRs/hosts, DNS rebinding, redirects and plaintext before socket work; loopback receives zero connections and self-signed TLS is rejected. **Node-only: Cloudflare Workers are not covered.** Runtime configuration/categories/grants/B3 are only a proposal. Deployment activation, external live-traffic acceptance, G4/G5, S4 independence and S6 release remain open. |
| Plugin SDK | `packages/plugin-sdk/` | ✅ Shipped v0.1.0 (MIT): capability catalog, `validateManifest` and the typed sandbox contract; the catalog/logic parity with the core is pinned by `tests/unit/plugin-sdk-parity.test.ts`. The HTTP installer and the real capability backends remain Phase 11.2 |

## Where every important document lives

- [`ROADMAP.md`](./ROADMAP.md) — prioritized checklist of what is missing. **Read this before proposing a new feature.** (Spanish long-form archive: `ROADMAP_es.md`.)
- [`CHANGELOG.md`](./CHANGELOG.md) — real history, version by version. (Spanish archive through the doc restructuring: `CHANGELOG_es.md`.)
- [`SECURITY.md`](./SECURITY.md) — known and active vulnerabilities (includes the real `isolated-vm` CVE, GHSA-864f-rcv7-6rh4).
- [`docs/README.md`](./docs/README.md) — index of the whole documentation tree.
- [`docs/api/`](./docs/api/) — integrator guide for Portaless HTTP APIs (public well-known endpoints, admin endpoints, verification recipes).
- [`docs/testing/release-acceptance.md`](./docs/testing/release-acceptance.md) — C40–C41 release evidence and the external gates that remain open.
- [`docs/decisions/0003-public-and-governed-resource-contract.md`](./docs/decisions/0003-public-and-governed-resource-contract.md) — approved architecture/D1–D9 baseline, not implementation permission. Read the sole [G1–G5 authorization register](./docs/protocol-apw/LTP-GATES-AND-AUTHORIZATIONS.md) before changing scope. Corpus/CI/merge grant no engine, network or budget authorization; S1–S6 still govern standard publication and acceptance.
- `docs/architecture/REPO_STRUCTURE_MAP.md` — why the real repo structure differs from the original proposal, and where each thing actually is.
- `docs/architecture/licensing-boundaries.md` — exact boundary between the AGPL-3.0 core, the MIT Plugin SDK, and third-party projects/plugins.
- `docs/architecture/mcp-agents.md` — MCP server design, 19 registered tools, per-invocation HTTP identity, and persistent audit.
- `docs/whitepaper/portaless-whitepaper.md` — full product vision (Spanish; much of it is design, not built code — always cross-check with the status table above).
- `docs/protocol-apw/` — normative APW specification v1.3 (`APW-SPEC-v1.3.md`, English canonical; `APW-SPEC-v1.3_es.md` Spanish archive) + test vectors. `apw-spec.md` there is a historical conceptual summary, not the code's state.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to propose changes.

## Code conventions this project follows strictly

1. **Every new module is optional by default.** Enabling commerce, Trust Layer, or sandboxing must never break the site when the module is off. See the `ENABLE_COMMERCE` / `ENABLE_TRUST_LAYER` pattern in `functions/_middleware.js` and `astro.config.mjs`.
2. **No plugin ever receives more capabilities than explicitly granted.** The rule lives in `packages/plugin-sandbox/src/runtime/sandbox-runtime.ts`: always use what the Permissions Center *granted*, never what the plugin *requested* in its manifest. The same principle applies to the MCP server via `requireCapability()` (`packages/mcp-server/src/permissions/require-capability.ts`) inside each tool — the agent identity checked is resolved **per invocation** on the HTTP transport (Option B) and is the fixed per-process env identity on stdio (Option A).
3. **Every plugin manifest declares atomic capabilities with a human-readable reason.** Full catalog: `packages/plugin-sandbox/src/capabilities/capability-registry.ts`.
4. **Never declare something "implemented" if it has a real integration `TODO` pending.** This project documents limitations honestly over pretending functionality — keep that standard in any code or documentation you add.
5. **All changes go through a Pull Request.** Never commit directly to `main`,
   even with merge permission. The project owner approves manually.
6. **The only surface a third-party plugin imports is `packages/plugin-sdk`** (MIT, shipped v0.1.0). No plugin may import core internals directly — all communication goes through the capability bridge (`ivm.Reference` + `hostBridge`).

## Expected agent workflow in this repo

1. Read `ROADMAP.md` to know which priority to attack.
2. Verify the affected module's real state in this file's table — do not trust the folder name.
3. Create a feature branch (e.g. `feat/what-you-are-doing`) from `main`.
4. Implement the change, including a test in `tests/unit/` or `tests/e2e/` if it resolves a `TODO`.
5. Update `CHANGELOG.md` and tick the matching `ROADMAP.md` checkbox if applicable.
6. Open or update the Pull Request from your feature branch to `main` — never merge directly, even with technical permission. The project owner approves manually.

How to verify (the `npx`/`node_modules/.bin` shims are broken under Node 24 in this environment — invoke the real CLIs):

- Unit/e2e: `node node_modules/vitest/vitest.mjs run` (all `*.test.ts` in the repo; `vitest.config.ts` excludes Playwright's `*.spec.ts`).
- Build: `node node_modules/astro/bin/astro.mjs build` (59 pages).
- Manifests: `node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts`.
- Browser (Playwright, real self-host runtime against `dist/`): `npx playwright test` (or `npm run test:browser`). The webServer boots `scripts/browser-test-server.mjs` (auto-builds if `dist/` is missing, seeds an admin + a `did:apw` identity in a temp SQLite under `test-results/browser-e2e/`). Runs serially on purpose (`workers: 1`): the flows mutate shared state.
- There is no typecheck (no tsconfig) — bugs surface through tests, not the compiler. Missing interface methods on store classes are exactly the kind of bug that only a runtime test catches.

## Active security risks any agent must know before touching these modules

- `isolated-vm` (self-hosted sandboxing adapter): versions ≤7.0.0 are vulnerable to RCE (GHSA-864f-rcv7-6rh4). The code already rejects vulnerable versions at instantiation — do not remove that check.
- The Permissions Center and the traceability ledger have real persistence connected — do not treat their data as disposable across deployments.
- The MCP server runs with a FIXED agent identity per process (Option A, see table) — do not assume cryptographic verification of who invokes each tool over stdio. If Option B is ever implemented, update this section and the status table.

## Reference tech stack

Astro 4.x + TypeScript, no heavy UI framework (dashboard panels and Atomic Elements render directly to DOM/HTML, no React/Vue). npm-workspaces monorepo (`packages/*`). Target deployment: GitHub Pages or Cloudflare Pages, no own server for the base use case.
