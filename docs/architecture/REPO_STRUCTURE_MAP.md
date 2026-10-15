# Repository structure map

> **What this document is.** A map of where things actually live, so nobody loses time looking for code in the location the *original* structure proposal predicted. Two sections: **where things are today** (the useful one) and **proposed vs. real** (the history of why the first five diverged).
>
> For the **state** of each module — what is implemented versus what is a skeleton — this document is not the source: [`AGENT.md`](../../AGENT.md) and [`ROADMAP.md`](../../ROADMAP.md) are. This file answers *where*, not *how much*.

---

## 1. Where things are today

### Root

| Path | What it is |
|---|---|
| `src/` | The Astro site: pages, layouts, content collections, commerce read path, `llms.txt` / `robots.txt` / `sitemap`, styles. The content engine is **not** in `packages/`. |
| `functions/` | Cloudflare Pages Functions — the dynamic runtime: middlewares, auth, OAuth, password recovery, Trust Layer endpoints, settlement, plugin run/install, admin APIs, `.well-known/` documents, first-run setup. |
| `server/` | Self-hosted Node runtime that executes the same `functions/` with Pages-compatible bindings, plus the first-run service. |
| `scripts/` | Setup (`schema.sql` + first admin in one command), schema generation, manifest validation, Docker entrypoint, screenshot capture, sandbox-adapter verification. |
| `infra/` | Deployable infrastructure that is not the app: e.g. the Cloudflare dispatcher Worker under `infra/cloudflare/dispatcher/`. |
| `schema.sql`, `schema-additions/` | The master schema (generated from 13 real sources: 5 package schemas + `schema-additions/*.sql`) and the per-feature additions that feed it. Regenerate with `scripts/generate-schema.mjs`. |
| `plugins-registry/`, `examples/` | Plugin registry data and reference configurations (blog, landing page, store). |
| `docs/` | Vision, whitepaper, architecture, Protocol APW spec/errata/vectors, API guides, deployment and self-hosting guides, roadmap archive, screenshots. See §3. |
| `tests/` | `tests/unit/`, `tests/browser/` (Playwright), `tests/e2e/`. |
| `wrangler.toml`, `docker-compose.yml`, `Dockerfile`, `railway.json`, `render.yaml` | Deployment surfaces, each for a supported target. |

### `packages/` — the workspace packages

Sixteen packages, each with its own `package.json`. The number of source files is this document's only quantity, and it is a size hint, not a status: **status lives in `AGENT.md`/`ROADMAP.md`.**

| Package | What it owns | Files |
|---|---|---|
| `apw-resolver/` | Protocol APW reference implementation: DNS TXT resolution, `did:apw` + key history, JWS/JCS artifacts, witness index, scoring, ranking, federation, the conformance runner and the `apw-conformance` bin. Published standalone (`.` = client, `./full` = everything). | 46 |
| `trust-layer/` | Web Bot Auth (RFC 9421, Ed25519 + experimental ML-DSA), SiteTrustScore with its 4 sources, access policies, the public usage ledger, cloud-image verification paths. | 33 |
| `atomic-elements/` | The visual editor: element registry and palette, block rendering, drag-and-drop, page layout model and validation, persistence (`PageStore`), theme packs, element packs. | 29 |
| `auth/` | `AuthService`: login, roles, TOTP/2FA, password recovery, OAuth/SSO, step-up verification, email sender abstraction, and the D1/SQLite stores behind them. | 27 |
| `mcp-server/` | The native MCP server: tools, transports (stdio and HTTP), per-invocation agent identity, capability checks, audit. | 27 |
| `plugin-sandbox/` | Multi-provider plugin isolation (isolated-vm, Cloudflare Workers for Platforms, Deno Deploy, Fastly), the capability bridge and registry, capability-token stores, the plugin registry, the production runner, and the installer (signed manifests, chunked artifacts, grant reconciliation). | 24 |
| `dashboard/` | Admin panel support: design tokens, skin engine and store, the activity feed (`emitActivity` + store), role guards, safe-DOM helpers. | 9 |
| `permissions/` | The Permissions Center: capability grants per plugin and per agent, with D1/SQLite persistence. | 8 |
| `deploy-engine/` | The publish path: draft filter, manifest publishing, GitHub Pages/Cloudflare deployment helpers. | 7 |
| `cloud-images/` | Cloud Images: signed PNG sidecars (`apw-image+jws`), the `cloud_images` store, local and standalone verification. | 7 |
| `identity-atproto/` | The optional AT Protocol <-> APW bridge: handle resolution, link confidences, reputation join. | 5 |
| `commerce-plugin/` | The commerce module's reference manifest (the real logic lives in `src/commerce/`). | 2 |
| `posse-syndicator-plugin/` | POSSE syndication into Bluesky and Mastodon, running inside the sandbox with `content:read` + `network:fetch`. | 2 |
| `plugin-sdk/` | The **MIT-licensed** typed surface for third-party plugin authors (0.1.0): its own declarations, capability catalog and `validateManifest`, importing nothing from the core. Equivalence is pinned by an AGPL-side parity test. | 1 |
| `onboarding/` | The wizard's intent→layout templates (portfolio, store, link-in-bio, landing). | 1 |
| `sqlite-driver/` | The shared `better-sqlite3` wrapper used by every SQLite store. | 1 |

---

## 2. Proposed vs. real: why the first five diverged

The original proposal nested everything under `packages/core/`. Five paths took a different route for concrete reasons, and re-reading this saves re-litigating it:

| Originally proposed | Where it really is | Why |
|---|---|---|
| `packages/core/` | Repository root (`src/`, `astro.config.mjs`) | Astro and its Vite tooling expect the project source at the root by convention; nesting it in `packages/core/` would have required extra configuration with no functional benefit for a single-site project. |
| `packages/core/src/sandbox/` | `packages/plugin-sandbox/` | Named for its function (multi-provider sandboxing) instead of nested under "core", because it is an independent package reusable by any Portaless installation. |
| `packages/core/src/admin/` | `packages/dashboard/` | Same reasoning: the admin panel is its own package with its own release cycle (the Skin System), not a folder inside core. |
| `packages/core/wrangler.jsonc` | `wrangler.toml` (root) | TOML was the project's initial configuration format; `.jsonc` is equally valid for Wrangler and the migration would have added no functional benefit. |
| `packages/commerce-plugin/` | `src/commerce/` (real implementation) + `packages/commerce-plugin/manifest.json` (reference manifest) | Commerce was built as part of the main Astro site before the sandbox's capability-manifest format existed. Moving the real logic behind the sandbox boundary remains pending work. |

### Packages that did follow the proposed layout

`mcp-server/`, `apw-resolver/`, `identity-atproto/`, `cloud-images/`, `plugin-sandbox/`, `dashboard/`, `permissions/`, `auth/`, `trust-layer/`, `plugin-sdk/`, `atomic-elements/`, `deploy-engine/`, `onboarding/`, `sqlite-driver/` — all exist as their own workspace package, which is what the proposal intended even when the folder is not literally under `core/`.

### Recommendation

Do not migrate `src/` into `packages/core/` just to match the original proposal: the cost of rewriting every import path is real and the benefit is purely cosmetic. If Portaless ever serves **multiple sites from one monorepo**, that is the moment to revisit this decision.

---

## 3. Where the documentation lives

The documentation is layered on purpose, so each file answers one question:

| File | Answers |
|---|---|
| [`docs/VISION.md`](../VISION.md) | **Direction**: what Portaless must become, and what it refuses to become. Carries no status, dates or paths. |
| [`docs/whitepaper/portaless-whitepaper.md`](../whitepaper/portaless-whitepaper.md) | **The original conceptual design** (v0.1), with its real implementation status noted inline. |
| [`docs/architecture/`](./) | **The technical model**, current: `content-layer.md`, `persistence.md`, `authentication.md`, `mcp-agents.md`, `site-trust-score.md`, `identity-atproto.md`, `cloud-images.md`, `commerce-plugin.md`, `deployment-engine.md`, `element-catalog-plugins.md`, `licensing-boundaries.md`, `ecosystem-boundaries.md`, `seo-geo.md`, `server-side-role-checks.md`, `content-architecture-and-use-cases.md`, `creator-sites-agentic-workflow.md`. |
| [`docs/protocol-apw/`](../protocol-apw/) | **The interoperable contract**: `APW-SPEC-v1.3.md`, `ERRATA.md` (E-1…E-15), the human-readable vectors and the machine-readable fixtures under `vectors/v1.3/`. |
| [`ROADMAP.md`](../../ROADMAP.md) | **State and next work**: what exists today, what is missing, what depends on third parties. |
| [`README.md`](../../README.md) | **The product today**: what Portaless is and how to install and use it. |
| [`AGENT.md`](../../AGENT.md) | The short version for contributors and AI agents, including the real state map per module. |
| [`docs/roadmap/ROADMAP-ARCHIVE.md`](../roadmap/ROADMAP-ARCHIVE.md) | History: the PR-by-PR log, deliberately kept out of the live documents. |
