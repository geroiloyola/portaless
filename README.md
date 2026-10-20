<div align="center">

# Portaless

**Less Portals, More Simplicity**

A lightweight, open source, modular CMS — built to be published without paid hosting, without plugins that break your site, and with real control over which AI agents can access your content.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-5A6B24?style=flat&labelColor=261C15)](./LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-alpha%20%2F%20MVP-F05D23?style=flat&labelColor=261C15)](./ROADMAP.md)
[![Astro](https://img.shields.io/badge/built%20with-Astro-6E6653?style=flat&labelColor=261C15)](https://astro.build)
[![Protocol APW](https://img.shields.io/badge/protocol-APW%20v1.3-5A6B24?style=flat&labelColor=261C15)](./docs/protocol-apw/APW-SPEC-v1.3.md)

[Vision](./docs/VISION.md) · [Roadmap](./ROADMAP.md) · [Live demo](https://geroiloyola.github.io/portaless/) · [Protocol APW](./docs/protocol-apw/APW-SPEC-v1.3.md) · [API guide](./docs/api/README.md) · [Docs index](./docs/README.md) · [Whitepaper](./docs/whitepaper/portaless-whitepaper.md) · [Security](./SECURITY.md) · [Licensing](./docs/architecture/licensing-boundaries.md) · [Contributing](./CONTRIBUTING.md)

> **New here?** Start with [`docs/START_HERE.md`](./docs/START_HERE.md) — the three-free-accounts path (GitHub + an AI with MCP + Cloudflare) from zero to a verifiable site you edit with an agent. Then [`VISION.md`](./docs/VISION.md) is where the project says what it must become — and what it refuses to become. It carries no status, versions or dates, so it does not go stale. What exists **today** is this README and [`ROADMAP.md`](./ROADMAP.md).

</div>

---

## What is Portaless?

Portaless is a CMS built on [Astro](https://astro.build) that solves, by architectural design, the most persistent structural problems of WordPress:

- **No exposed database, no server to manage** — the site compiles to static HTML and is served from free infrastructure (GitHub Pages, Cloudflare Pages).
- **Sandboxed plugins with atomic permissions**, instead of unrestricted access to the core (the root cause of 96% of WordPress's historical vulnerabilities).
- **Granular control over AI agents**: cryptographic bot identification, pay-per-crawl policies, and a public traceability ledger. You decide, from the panel, who may read your site — search engines, AI assistants, model training — and the site answers accordingly, in writing.
- **A native visual editor (Atomic Elements)**, designed to be radically lighter than Elementor.
- **A modular dashboard with swappable "skins"**, no CSS or PHP required.
- **Real account protection**: two-factor authentication, password recovery, and login via external providers (Google, GitHub, etc.).
- **Cross-site trust and discovery** via Protocol APW and a public `SiteTrustScore`, so independent Portaless instances can verify each other without any central authority.

> **Current status: alpha / MVP.** Not everything described in the whitepaper is implemented yet. Before using this in production, read the [Real status by module](#real-status-by-module) section and [`ROADMAP.md`](./ROADMAP.md).

---

## See Portaless in action

**Live demo (no install needed): [geroiloyola.github.io/portaless](https://geroiloyola.github.io/portaless/)** — the public site deployed from this repo on every push to `main`. GitHub Pages runs no `functions/`, so the demo shows the static site only (home, blog, example pages); admin, login, and the dynamic `/trust/:siteId` need [self-host or Cloudflare Pages](#deployment).

Real screenshots of the running product — captured from the live app, not mockups. Regenerate them anytime with `npm run build && node node_modules/tsx/dist/cli.mjs scripts/capture-screenshots.mjs` (output in [`docs/screenshots/`](./docs/screenshots)).

| The public site: a link-in-bio page built by dragging Atomic Elements | The visual editor: palette, live canvas, properties |
|---|---|
| [![Link-in-bio page built with Atomic Elements](docs/screenshots/public-link-in-bio.png)](docs/screenshots/public-link-in-bio.png) | [![Visual editor with the page loaded](docs/screenshots/editor-atomic-elements.png)](docs/screenshots/editor-atomic-elements.png) |

| The admin dashboard | SiteTrustScore — public, per site, 4 sources |
|---|---|
| [![Admin dashboard with the APW identity panel](docs/screenshots/admin-dashboard.png)](docs/screenshots/admin-dashboard.png) | [![SiteTrustScore page for the site](docs/screenshots/trust-score.png)](docs/screenshots/trust-score.png) |

**The whole edit → publish cycle in one take**: drag an element into the canvas, click *Publicar*, open the public URL — no terminal, no rebuild (self-host / Cloudflare Pages):

![Dragging a button in the editor, publishing, and seeing it on the public page](docs/screenshots/editor-publish.gif)

---

## Public Beta

Portaless is in its **first public Beta**. What that means honestly:

- **Ready today**: the full edit→publish cycle from the browser (17-element catalog, 6 skins), `did:apw` cryptographic identity with key rotation, SiteTrustScore (4 sources), external witnesses, the Portaless Index aggregator with calibrated weights and inter-node sync, plugin sandboxing, an MIT-licensed [plugin SDK](./packages/plugin-sdk/) (with a [plugin-author guide](./docs/plugin-author-guide.md)), signed community attestations, a recomputable ranking defined in the spec (V-16), and the open [Protocol APW](./docs/protocol-apw/APW-SPEC-v1.3.md) with independently checkable [test vectors](./docs/protocol-apw/APW-VECTORS-v1.3.md) that run as an **executable conformance suite** (110/110 cases over 11 vectors) plus a [starter kit](./docs/protocol-apw/STARTER-KIT.md) for implementers who never saw this code.
- **Not ready yet**: the final GitHub-Pages publish step still needs a terminal; Cloudflare Pages OAuth in the wizard is “coming soon”; the plugin installer exists but is **behind a flag, off by default**, and five capability backends still answer an explicit `501` (`content:*`, `storage:*`, `agent:identify` and `email:send` are real); discovery across nodes has a shipped mechanism but **no public endpoint, because there are no peers to federate with**; this Beta has a **single maintainer**, so it is **invite-only** — no public sign-up until a second maintainer with real merge permissions exists ([the recorded decision](./SECURITY.md#bus-factor-single-maintainer-risk)); and the roadmap's exit criterion — a person outside the project installing Portaless unaided, with their site appearing in an Index node that is not the author's — has **not been met yet**. “Beta” is the honest name for that stage, not a marketing number.
- **Where it is going**: [`docs/VISION.md`](./docs/VISION.md), which carries no status and no dates on purpose. What is missing today, item by item, is [`ROADMAP.md`](./ROADMAP.md) — organized by *who* has to resolve each piece: Portaless, or a third party.
- **The core does not sell hosting or assisted install.** That is the providers' business (Cloudum, or any Portaless provider that appears). What the core gives you is that your site belongs to you and that a third party can verify it. A free install is roughly 30 minutes following tutorials; a 5-minute assisted install is bought from a provider. The honest prerequisite list — GitHub, Cloudflare, an MCP client — is in [`docs/first-steps.md`](./docs/first-steps.md).
- **Install in 10 minutes** (Docker + browser, non-technical guide with screenshots): [`docs/first-steps.md`](./docs/first-steps.md). Announcement page on the demo: [geroiloyola.github.io/portaless/beta](https://geroiloyola.github.io/portaless/beta). The transparency standard for first-time visitors is the same one this repo uses for readers of the code: see [`ROADMAP.md`](./ROADMAP.md) (“Real status by module”).

---

## Table of contents

- [What is Portaless?](#what-is-portaless)
- [See Portaless in action](#see-portaless-in-action)
- [Public Beta](#public-beta)
- [Features](#features)
- [Recent updates](#recent-updates)
- [Real status by module](#real-status-by-module)
- [Installation](#installation)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Windows](#windows)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Authentication](#authentication)
- [Licensing](#licensing)
- [Roadmap](#roadmap)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Module | What it does |
|---|---|
| **Content engine** | Astro + Markdown, 100% static site, no mandatory server runtime |
| **Atomic Elements** | Drag-and-drop visual page editor, without Elementor's DOM depth or page weight — 17 elements (Hero, columns, media, Video, FAQ, Testimonial, contact Form, Gallery…) including 4 for sovereign link-in-bio pages (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`) |
| **Dashboard + Skin System** | Modular admin panel: each "skin" rearranges the same components via a JSON file, no code required |
| **Commerce (Medusa/Mercur)** | Optional module that consumes an external store's catalog — never reimplements checkout or payments |
| **Trust Layer** | AI agent identification (Web Bot Auth, RFC 9421/Ed25519, same draft-03 header rules as Cloudflare), access policies (`allow`/`charge`/`block`), a publicly queryable traceability ledger, and pay-per-crawl through pluggable settlement providers (`cloudflare-pay-per-crawl` today) — Portaless never touches the money |
| **AI discovery** | `/llms.txt` (llmstxt.org v2), a markdown version of every post (`/blog/<id>.md`), a single `robots.txt` generated by the Trust Layer with Content Signals, and a complete `sitemap.xml` — drafts are never published |
| **SiteTrustScore** | Public, multi-source trust score per site (`self`, `agent`, `community`, `escrow_report`), with admin UI to grant/revoke authorized agents and escrow providers without touching a terminal |
| **Protocol APW** | Cross-site discovery via DNS TXT record (`_apw.yourdomain.com`), resolved over DNS-over-HTTPS, with a manifest (`siteId`, `trustUrl`, `contentKinds`) and a CLI to publish it |
| **MCP server** | Native Model Context Protocol server — an AI agent can create/update pages, query the usage ledger, list installed plugins, and manage permissions directly |
| **Plugin Sandbox** | Multi-provider plugin isolation (Cloudflare, Deno Deploy, Fastly, or self-hosted via `isolated-vm`), with all 12 plugin capabilities from the catalog wired to real code |
| **Permissions Center** | Atomic per-plugin/per-agent capability control, like the iOS/Android Privacy screen — connected to real persistence, with a community-driven `trustScore` badge per plugin. Pay-per-crawl providers appear here too, but can only be activated from `/admin/settlement` with verified credentials |
| **Authentication** | Username/password login with roles (`admin`/`viewer`), two-factor authentication, password recovery, and login via external providers (OAuth/SSO) |
| **Self-hosting** | Node runtime that runs the same `functions/` as Cloudflare Pages, Docker image, Docker Compose, Railway and Render configs, and a first-run `/setup` screen to create the admin without a terminal |

## Recent updates

The "what shipped in each release" narrative deliberately does not live in this README anymore. It is split, like the roadmap:

- [`CHANGELOG.md`](./CHANGELOG.md) — what was added, fixed or pending in each version.
- [`docs/roadmap/ROADMAP-ARCHIVE.md`](./docs/roadmap/ROADMAP-ARCHIVE.md) — the immutable roadmap log (PRs #1–#75, refactor registers, closed entries with their full session context).

For what is true **today**, read [Real status by module](#real-status-by-module) below and [`ROADMAP.md`](./ROADMAP.md) — both describe only the current state.

## Real status by module

This project explicitly documents what's implemented versus what's a pending skeleton. Don't assume functionality from a folder name — check [`AGENT.md`](./AGENT.md) and [`ROADMAP.md`](./ROADMAP.md) for the live detail, and [`VISION.md`](./docs/VISION.md) for where it is all going (which is a different question, and deliberately a different file). Summary:

| Module | Status |
|---|---|
| Content engine, commerce (read), Atomic Elements, Dashboard | ✅ Functional |
| Authentication (login + D1/SQLite persistence + 2FA + password recovery + OAuth/SSO) | ✅ Functional: persistent MFA, rate-limited login/reset, reset email via configured webhook/SMTP — a real relay check is operator-specific; see [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) |
| Permissions Center | ✅ UI connected to real persistence (D1/SQLite) via `functions/admin/permissions/index.js`, with server-side guard `canWrite(role)` — plugin catalog now backed by a real dynamic registry with community `trustScore`, see [`PERMISSIONS_CENTER.md`](./packages/permissions/docs/PERMISSIONS_CENTER.md). Billing grants (`billing:*`) are rejected by the generic endpoint and only written by `/admin/settlement` |
| Trust Layer (policies + ledger) | ✅ Write path connected since v0.0.6, public read path connected in v0.0.9.3 via `GET /.well-known/portaless-usage-log.json` — see [`TRUST_LAYER_SETUP.md`](./packages/trust-layer/docs/TRUST_LAYER_SETUP.md). The middleware applies the effective policy (panel override > your published file > Portaless default) on Cloudflare Pages and self-hosted Node, and lets discovery routes (`robots.txt`, `llms.txt`, `sitemap.xml`, `/.well-known/*`, `/blog/*.md`) through without a signature |
| Pay-per-crawl (`cloudflare-pay-per-crawl`) | 🟡 Implemented: in-band `crawler-price` behind Cloudflare, activation only with a verified Cloudflare API token (Zone Read) + admin password/2FA + APW site identity. Pending: test against a live Cloudflare zone with Pay Per Crawl enabled (today only mocked tests) and confirm the minimum price (assumed USD 0.01). The `settlement_provider_activations` table is in the master `schema.sql` and `REQUIRED_TABLES` since v0.0.9.10 (stores still create it on the fly for pre-existing databases). Without an active provider, `charge` responds `402` with `settlement: "not_available"` and nothing is charged |
| AI discovery (`llms.txt`, markdown per post, `robots.txt`, sitemap) | ✅ Generated at build time from your content and AI policy. Limitation: pages stored only in D1/SQLite are not included in `llms.txt` |
| SiteTrustScore (4 sources: self, agent, community, escrow_report) | ✅ All 4 sources have a connected HTTP endpoint; `agent` and `escrow_report` have a full admin lifecycle (grant/revoke UI, no manual API calls needed). Pending: both allowlists are empty by default, and there's no automated onboarding flow for a second escrow provider yet |
| Protocol APW (cross-site identity, trust and discovery) | ✅ Full implementation of the normative spec v1.3 ([`APW-SPEC-v1.3.md`](./docs/protocol-apw/APW-SPEC-v1.3.md)): DNS-over-HTTPS resolution of the `_apw.` TXT record (manifest v2 with `k`/`h`/`rg`), `did:apw` identity with key rotation and public `did.json`, signed site artifacts (JWS + JCS), issuer-signed attestations (`agent`, `escrow_report`, `self`), a hash-chained, DNS-anchored attestation history (`/.well-known/apw-log.json` + `/.well-known/apw-attestations.json`), external witnesses (§5.7), the Portaless Index aggregator with A.4.4-style calibration and inter-node sync (§5.7 informative, erratum E-12), per-dimension scoring, and fail-closed read governance with reader reputation (`reader_conduct`). An errata series (E-1…E-15) carries the normative changes without a version bump — including E-13 (signed community attestations), E-14 (the signed pages document) and E-15 (the signed plugin manifest). Test vectors are published separately in [`APW-VECTORS-v1.3.md`](./docs/protocol-apw/APW-VECTORS-v1.3.md), independent of this codebase, and now run **executably** in CI: **110/110 cases over 11 vectors**, including the machine-readable fixtures under `docs/protocol-apw/vectors/v1.3/`; external implementers start at [`STARTER-KIT.md`](./docs/protocol-apw/STARTER-KIT.md) and can run the published `apw-conformance` bin against their own implementation. Pending: pasting the `_apw.` TXT into the DNS provider is still manual (the `h` value is computed for the operator), the `did:web` Path A subject-mapping erratum, and — above all — a second real implementer (Phase 4) |
| MCP server | ✅ 19 tools, including bounded public/private context reads and exact-revision proposal/list/approve flow. The admin page manager reviews proposal diffs and approves the exact revision. Private reads and publication require separate grants. HTTP authenticates each request; audit events persist append-only in D1/SQLite. See [`docs/architecture/mcp-agents.md`](./docs/architecture/mcp-agents.md). |
| Plugin SDK (MIT) | ✅ `packages/plugin-sdk` 0.1.0 — the typed surface for third-party authors: capability catalog, `validateManifest` and the sandbox contract, re-declared with **no AGPL code imported**; equivalence with the core is pinned by an AGPL-side parity test, and its tarball is checked in CI (pack → install into an empty project → type-check a consumer + runtime import). **Honest scope**: the capability surface is provisional until the capability backends close — [the SDK README](./packages/plugin-sdk/README.md) says so |
| Plugin installer (HTTP) | 🟡 Mechanism + runtime execution shipped **behind a flag that is off by default** (`PORTALESS_PLUGIN_INSTALLER`; the endpoint answers 404 without it and is not announced). It requires step-up, verifies a publisher-signed manifest against the resolved `did:apw` identity (ERRATA **E-15**, signature covers `requestedCapabilities`), stores code chunked in BLOB with a hard cap **together with its verified manifest**, and **grants nothing** — installing registers, and the grant stays `granted ∩ manifest` in the Permissions Center. `POST /admin/api/plugins/run` loads from `PluginArtifactStore` first (verifying `sha256Hex(code) === codeHash`) and falls back to disk only when no artifact is stored, closing the workerd `503 plugin_source_backend_unavailable` for installed plugins. Pending: the external sandbox review (which keeps the flag off by default), and the five capability backends that remain `501` by decision (`storage:read/write` shipped in Phase 14 §14.2, `agent:identify` right after, `email:send` in the review round) |
| Community reputation (signed) | ✅ A community evaluation is a JWS signed by a `did:apw` (ERRATA **E-13**): `POST /trust/:siteId/community-attestation` verifies it against the emitter's resolved identity, the anonymous route answers `410`, and `min_weight` (2.0 per subject and category), distinct-emitter counting and the 7-day history floor are implemented and fixture-checked (vectors **V-14**, **V-15**). Pending: **portable** reputation (the emitter's own chain is not fetched yet) and, above all, real emitters — today there is one |
| Federated query + ranking | 🟡 **Ranking shipped (Phase 9a)**: normative filter semantics in spec §7.1, executable as vector **V-16** (total order with a full tie-break tuple; an empty subject is never filled with the neutral prior), with the filters exposed in the `/explore` UI and an **honest degraded state** — the page is static, so it declares its local source, build instant and window instead of faking a ranking. **Federation mechanism shipped (Phase 9b)**: signed `/.well-known/apw-pages.jws` (ERRATA **E-14**) plus a hardened peer reader (per-hop redirect validation, streaming byte cap, private-range blocking, sanitized render, mandatory cache + single-flight + stale-while-error), verified against fixtures. Pending: the public endpoint is deliberately not opened — it would fan out to peers that do not exist yet |
| Dashboard activity feed | ✅ The seven mock panels were deleted (they were dead code) and replaced by a real, **admin-only** feed: append-only `activity_events` (D1 → SQLite → InMemory), a single writer `emitActivity()` with **no triggers and no backfill**, `GET /admin/api/recents` and `/admin/recents`. It records pages saved/deleted, community attestations, permission changes, witness statements and password changes/resets — and **not** orders, revenue or human traffic, which have no data source. It stores no IPs |
| Plugin sandboxing (4 adapters) | 🟡 `isolated-vm` (self-hosted) runs real code with an isolate pool and **12/12 plugin capabilities with a real bridge** (`billing:pay-per-crawl` is an admin-only capability for settlement providers, not a plugin capability, and has no sandbox bridge by design). The non-network capability backends are wired **one at a time** (Phase 14): `content:read/write`, `storage:read/write` (per-plugin namespace + quotas), `agent:identify` (the Trust Layer usage ledger) and `email:send` (blind delegation: the plugin sends `{ template, to, data }`, the core injects the site `from` and enforces a per-plugin daily quota) are real and served from one place (`capability-backends.ts`), so they work the same through the HTTP bridge (edge adapters) and in-process (self-host); the other five (`media:*`, `commerce:*`, `site:admin`) answer an explicit `501 NOT_CONFIGURED`. Cloudflare Workers for Platforms and Deno Deploy make real calls to their APIs (not yet verified against a real account, only tested with mocked `fetch`); Fastly remains contract + detailed TODOs only, no real API call yet |
| Web Bot Auth cryptographic verification | ✅ Validates Ed25519 signatures (RFC 9421) with key-directory caching and nonce-uniqueness checks. Both verifiers share draft-03 header rules (quoted `Signature-Agent`, signed `signature-agent`, `tag="web-bot-auth"`), with an end-to-end test and an interoperability test against the official `web-bot-auth` library. Since v0.0.9.31 nonces are stored in D1/SQLite (`webbotauth_nonces`, TTL 300 s) when a backend is configured, so replay protection is shared across instances (in-memory fallback for single-process dev). ML-DSA-44/65/87 is supported in both the middleware verifier and the `SiteTrustScore` verifier (shared implementation, `@noble/post-quantum`, still awaiting an independent audit) |
| Installation / setup | ✅ Single command (`npm run setup`) for self-hosted SQLite, or first run from `/setup` with a one-time code in the Node runtime — Cloudflare D1 still uses `wrangler d1 execute` (or `npm run setup:d1`) separately |
| Self-hosting (Node runtime, Docker, Railway, Render) | 🟡 Node runtime with Pages-compatible routing, middleware and `env.ASSETS`; Docker image built and exercised in CI (`docker-smoke`). Pending: real deployments on Railway and Render (checklist in `docs/self-hosting-verification.md`) |
| Native AT Protocol identity | ✅ Optional symbiotic bridge with APW since v0.0.9.10: spec handle<->DID resolution, the three link confidences, `buildAtprotoReputation()` behind public `GET /trust/atproto/:handle`, and admin-managed `alsoKnownAs` links in `/.well-known/did.json`. Limitation: resolution depends on third parties (DNS, plc.directory); the whitepaper's own PDS/Lexicons vision remains unimplemented — `docs/architecture/identity-atproto.md` |
| Portaless Cloud Images (APW-signed image hosting) | 🟡 Cryptographic base implemented in v0.0.9.10: Cloud Image v1 payload + server-side Ed25519 sidecar (`typ: apw-image+jws`), PNG `pAPW` chunk embedding, upload with automatic signing, immutable serve, local verification and standalone verification against the APW registry (C2PA without a central authority). Pending: R2 storage for large images, moderation of declared origin, sidecar transport for non-PNG formats, management UI — `docs/architecture/cloud-images.md` |
| Portaless Index | ✅ Local aggregator shipped (v0.0.9.10): `POST /admin/api/index/sync` verifies witness statements end-to-end fail-closed, caches per-subject directory entries with **A.4.4-style calibrated weights** (a witness gains weight by agreeing with the consensus), publishes the plain re-verifiable document at `GET /.well-known/apw-index.json`, and syncs with other Index nodes via peer discovery (`POST /admin/api/index/sync-peers` — peers are hints, everything is re-verified locally). Operator UI at `/admin/witness-index`. Pending for "a real network": more than one real operator/instance (Phase 4 dependency) and manifest/SiteTrustScore discovery across instances (spec §7) |

---

## Installation

> **Non-technical?** The step-by-step guide with screenshots (Docker + browser only, ~10 minutes) is [`docs/first-steps.md`](./docs/first-steps.md) (Spanish). The sections below are the developer-grade version.

### Prerequisites

- **Node.js ≥ 24** (required by `isolated-vm@7`, used for self-hosted plugin sandboxing — installing on Node 20-23 will let `npm install` succeed with only a warning, then fail silently at runtime when the sandbox loads). Self-hosted SQLite persistence uses `better-sqlite3` (a compiled native dependency, not `node:sqlite`) — no extra Node version requirement beyond the 24 minimum above.
- **Git**.
- A **GitHub** or **Cloudflare** account if you plan to deploy (both have free tiers that are sufficient).

### macOS

```bash
# Install Node.js (via Homebrew)
brew install node@24

# Clone the repository
git clone https://github.com/geroiloyola/portaless.git
cd portaless

# Install dependencies (uses npm workspaces for packages/*)
npm install
```

### Linux

```bash
# Debian/Ubuntu — install Node.js 24.x via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Fedora/RHEL
sudo dnf install nodejs git

# Clone and install
git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

### Windows

**Recommended: WSL2** (Windows Subsystem for Linux), to avoid path and permission issues with Astro and native compiled dependencies like `better-sqlite3`:

```powershell
wsl --install
```

Then, inside the WSL terminal (Ubuntu), follow the **Linux** steps above.

**Alternative without WSL** (PowerShell):

```powershell
# Install Node.js from https://nodejs.org (choose version 24 LTS)
# or via winget:
winget install OpenJS.NodeJS.LTS

git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

> If you regenerate `package-lock.json` on Windows, use a recent npm (`npx npm@11 install --package-lock-only`). Older npm versions can omit optional dependencies that Linux CI needs, and `npm ci` will fail.

---

## Getting started

```bash
# Start the dev server
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) — you should see the example site with the starter blog.

```bash
# Build for production (generates ./dist)
npm run build

# Preview the production build locally
npm run preview
```

If you're going to use the admin panel (`/admin`) on a self-hosted SQLite deployment, also run:

```bash
# Creates the necessary tables and the first admin user, in one step
npm run setup
```

Or start the self-hosted runtime and create the admin from the browser:

```bash
npm run build
PORTALESS_SQLITE_PATH=./portaless.db npm start
# Open http://localhost:3000/setup and enter the setup code printed in the logs
```

See the [Authentication](#authentication) section for the full detail, including the equivalent flow for Cloudflare D1.

---

## Configuration

All environment variables are optional — Portaless works out of the box, serving just the base static site. The one functional exception is `IP_HASH_SALT`: without it the community vote endpoint (`POST /trust/:siteId/vote`) fails closed with `500 server_misconfigured` instead of using a public development salt, because a public salt makes an IPv4 hash reversible by brute force.

| Variable | Module | Description |
|---|---|---|
| `ENABLE_COMMERCE` | Commerce | `true` to enable `/shop` (requires `src/commerce/config.ts`, see [`docs/COMMERCE_SETUP.md`](./docs/COMMERCE_SETUP.md)) |
| `ENABLE_TRUST_LAYER` | Trust Layer | `true` to enable AI agent verification in `functions/_middleware.js` (Cloudflare Pages and self-hosted Node) |
| `IP_HASH_SALT` | SiteTrustScore (community votes) | **Required for community voting.** Salt used to hash the voter's IP before it is stored. Without it, `POST /trust/:siteId/vote` responds `500 server_misconfigured` and the vote is disabled — there is deliberately no fallback salt |
| `PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY` | Deployment OAuth, pay-per-crawl | Secret of at least 32 characters used to encrypt infrastructure credentials at rest (deployment tokens and the settlement provider's API token). Required to activate a pay-per-crawl provider |
| `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` | Protocol APW (`did:apw`) | Base64 key that encrypts the site's private identity key at rest. In the Node runtime, if it's missing, one is generated inside the data volume and `/setup` warns you to move it to a platform secret |
| `PORTALESS_SITE_NAME` / `PORTALESS_SITE_DESCRIPTION` | AI discovery | Name and summary shown at the top of `/llms.txt` |
| `PORTALESS_SETUP_CODE` | Self-hosting (first run) | Optional setup code set by your platform; if omitted, one is generated and printed in the logs (valid 60 minutes, 5 attempts, single use) |
| `PORTALESS_DATA_DIR` / `PORT` / `HOST` | Self-hosting | Data directory for secrets (default: the SQLite file's folder, `/data` in Docker), and the listening port/host (default `3000` / `0.0.0.0`) |
| `PORTALESS_ADMIN_USERNAME` / `PORTALESS_ADMIN_PASSWORD` | Authentication | Credentials for the first admin user, used by `npm run setup` |
| `PORTALESS_SQLITE_PATH` | Authentication | Path to a SQLite file for self-hosted persistence, via `better-sqlite3` — no special Node version requirement beyond the project minimum (Node ≥ 24, see Prerequisites). Required by `npm start` |
| `PORTALESS_OAUTH_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` / `_AUTH_URL` / `_TOKEN_URL` / `_USERINFO_URL` | Authentication (OAuth/SSO) | Configuration for each external login provider (e.g. `PORTALESS_OAUTH_GOOGLE_CLIENT_ID`) — without this, login via that provider simply won't appear as an option |
| `PORTALESS_DEV_MODE` | Authentication (password recovery) | `1` so the recovery endpoint returns the token in the response, useful only for local development without a configured mail server |
| `DB` (binding, not a traditional env var) | Authentication, Permissions, Trust Layer, Pages | Cloudflare D1 binding, configured in `wrangler.toml` |

Copy `src/commerce/config.example.ts` to `config.ts` if you're enabling commerce.

### Pay-per-crawl (optional)

To charge AI crawlers through Cloudflare Pay Per Crawl:

1. Serve the site through Cloudflare with Pay Per Crawl and dynamic pricing enabled for the domain. Make sure the origin only accepts traffic that comes through Cloudflare (e.g. Cloudflare Tunnel or Authenticated Origin Pulls) — otherwise the `cf-pay-per-crawl` header could be spoofed.
2. Generate the site's APW identity in the onboarding wizard (it defines the site domain).
3. Set the `charge` rule with a `price_usd` of at least `0.01`, and `"settlement_provider": "cloudflare-pay-per-crawl"`. The three rules (`search`, `ai_input`, `ai_train`) can be saved from the panel in [`/admin/agents`](#public-beta), which takes precedence over the file; the settlement provider lives only in `portaless-content-policy.json`, so edit that file for it.
4. In `/admin/settlement`, enter a Cloudflare API token with **Zone Read** only (never the Global API Key) and the Zone ID, plus your password (and 2FA code, if enabled). Portaless verifies the token against the zone before activating anything.

Portaless never processes the payment: Cloudflare charges the crawler. The ledger records the access with `charged: false` because the origin cannot know whether the crawler paid.

---

## Project structure

```
portaless/
├── src/                    # Astro site (pages, content, layouts, commerce, llms.txt/robots.txt/sitemap)
├── packages/
│   ├── atomic-elements/    # Visual page editor (element registry, drag-and-drop, page model, theme packs)
│   ├── dashboard/          # Admin panel + Skin System + the real activity feed (emitActivity)
│   ├── permissions/        # Permissions Center (grants per plugin and per agent)
│   ├── plugin-sandbox/     # Multi-provider sandboxing, capability bridge, plugin registry + installer
│   ├── plugin-sdk/         # MIT-licensed typed surface for third-party plugin authors (0.1.0, self-contained)
│   ├── trust-layer/        # AI agent identification + SiteTrustScore + pay-per-crawl providers
│   ├── apw-resolver/       # Protocol APW reference implementation: resolver, did:apw, witnesses, scoring, ranking, federation, the `apw-conformance` runner
│   ├── mcp-server/         # Native MCP server (19 tools; per-invocation agent identity on HTTP)
│   ├── auth/               # Authentication (login, roles, 2FA, recovery, OAuth, step-up, persistence)
│   ├── deploy-engine/      # Publish path: draft filter, manifests, GitHub Pages / Cloudflare deployment
│   ├── onboarding/         # Wizard intent→layout templates
│   ├── commerce-plugin/    # Reference manifest for the commerce module (real logic in src/commerce/)
│   ├── posse-syndicator-plugin/ # POSSE syndication to Bluesky and Mastodon, inside the sandbox
│   ├── identity-atproto/   # AT Protocol identity + optional APW bridge
│   ├── cloud-images/       # Cloud Images: APW-signed image sidecars (C2PA without a central authority)
│   └── sqlite-driver/      # Shared better-sqlite3 wrapper used by every SQLite store
├── functions/              # Cloudflare Pages Functions (middlewares, login, OAuth, recovery, trust endpoints, settlement, plugin run/install, admin APIs, first-run setup)
├── server/                 # Self-hosted Node runtime and first-run service (runs functions/ with Pages-compatible bindings)
├── scripts/                # Setup (schema.sql + initial admin in one command), schema generation, manifest validation, Docker entrypoint
├── infra/                  # Deployable infrastructure that is not the app (e.g. the Cloudflare dispatcher Worker)
├── schema.sql              # Master schema, generated from 29 sources (regenerate with scripts/generate-schema.mjs)
├── docs/                   # Vision, whitepaper, architecture, Protocol APW spec/errata/vectors, deployment guides
├── examples/               # Reference configurations (blog, landing page, store)
├── tests/                  # Unit, browser (Playwright) and e2e tests
├── Dockerfile              # Multi-stage image (node:24-bookworm-slim); also docker-compose.yml, railway.json, render.yaml
└── ROADMAP.md              # Current state of the project (history in docs/roadmap/)
```

See [`docs/architecture/REPO_STRUCTURE_MAP.md`](./docs/architecture/REPO_STRUCTURE_MAP.md) if you're looking for something and it's not where you'd expect.

---

## Deployment

### GitHub Pages (free)

Full guide: [`docs/DEPLOY_GITHUB_PAGES.md`](./docs/DEPLOY_GITHUB_PAGES.md). Pushes to `main` build the site in CI (`.github/workflows/ci.yml`) and, when the repo has **Settings → Pages → Source: GitHub Actions** enabled, `.github/workflows/deploy-pages.yml` also publishes the static demo to `https://<owner>.github.io/portaless/`. GitHub Pages runs no `functions/`, so the demo shows the public site only (home, blog, example pages); admin, login, and dynamic `/trust/:siteId` need Cloudflare Pages or self-hosting.

### Cloudflare Pages (free, recommended if using Trust Layer or D1 authentication)

Full guide: [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](./docs/DEPLOY_CLOUDFLARE_PAGES.md). Required if you want to use `functions/` (middlewares, sandboxing, login, OAuth, password recovery, trust endpoints) on a static host — GitHub Pages doesn't support edge functions.

### Self-hosted (Node, Docker, Railway, Render)

`npm start` runs the self-hosted Node runtime (`server/node-runtime.mjs`), which executes the same `functions/` as Cloudflare Pages — including the Trust Layer middleware — with SQLite persistence and an `env.ASSETS` binding equivalent to Pages. It requires `PORTALESS_SQLITE_PATH` and exposes `GET /healthz`.

For containers, the repo includes a multi-stage `Dockerfile` (`node:24-bookworm-slim`), `docker-compose.yml`, `railway.json`, and `render.yaml`, all with a persistent volume at `/data`. On first boot, open `/setup` and enter the one-time setup code printed in the logs (also saved to `/data/SETUP_CODE.txt`) to create the first admin. Full guide: [`docs/self-hosting.md`](./docs/self-hosting.md). Railway and Render have not been verified with real deployments yet — see [`docs/self-hosting-verification.md`](./docs/self-hosting-verification.md).

---

## Authentication

```bash
# Self-hosted with SQLite -- applies the database schema AND creates the
# first admin user, in a single command
PORTALESS_ADMIN_USERNAME=admin \
PORTALESS_ADMIN_PASSWORD=a-password-with-at-least-12-characters \
PORTALESS_SQLITE_PATH=./portaless.db \
npm run setup
```

Then visit `/admin/login`. From there you can also:

- Enable **two-factor authentication** (2FA) for your account.
- Recover your password if you forgot it, via `/admin/password-reset` (rate-limited per IP and per user).
- Log in with a configured external provider (`/admin/oauth/<provider>/start`), if you added its environment variables.

In the self-hosted Node runtime you can skip `npm run setup` entirely: on first boot, `/setup` creates the first admin with a one-time setup code (valid 60 minutes, 5 attempts). It is disabled as soon as any user exists, and it doesn't exist on Cloudflare Pages.

For Cloudflare D1, apply the schema with `wrangler d1 execute <DB_NAME> --file=schema.sql` (or `npm run setup:d1`) — the first admin user is created automatically the first time the system detects that none exists.

See [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) for the full detail, including the honest limitations that remain (see [`ROADMAP.md`](./ROADMAP.md) for the exact status of each piece).

---

## Licensing

Portaless (the core: CMS, dashboard, authentication, Trust Layer, Permissions Center, sandbox engine) is distributed under **AGPL-3.0**. In plain terms: you can install it, use it, and modify it freely, even inside your own business — the only obligation kicks in if you take a modified version of the core and offer it as an online service to third parties, in which case you must share those changes back.

**The Protocol APW specification** (spec, errata, and test vectors under `docs/protocol-apw/`) is published under **CC BY 4.0** — reimplement it, translate it, and use it commercially with attribution to the author; no registration or certification from Portaless is required. The spec's license and the code's license do not contaminate each other. See [License and governance](./docs/protocol-apw/APW-SPEC-v1.3.md#licencia-y-gobernanza).

**Third-party plugins** (paid, free, or closed-source) carry no such obligation, as long as they run inside the isolated sandbox and only use the documented public API — this is the same principle that allows selling closed-source WordPress plugins. See [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md) for the full explanation, including FAQs for anyone building or selling plugins.

---

## Roadmap

[`ROADMAP.md`](./ROADMAP.md) is the source of truth for **what is true today**, organized into three categories by who owns each piece:

- **Features in production** — already built, merged to `main`, and functional today.
- **Internal features in development** — still pending, but exclusively Portaless's responsibility, with no third-party dependency.
- **External features** — depend on a third party (payment companies, cloud providers, other open source projects) to be completed.

History is deliberately kept elsewhere, so the roadmap stays readable: [`docs/roadmap/ROADMAP-ARCHIVE.md`](./docs/roadmap/ROADMAP-ARCHIVE.md) preserves the full log (PRs #1–#75, refactor registers, closed entries with their session context) and [`CHANGELOG.md`](./CHANGELOG.md) records what shipped per version.

The largest item still awaiting **external reality** (not code) is **Portaless Index as a real network**: the local aggregator, weight calibration and inter-node sync are implemented, but a network needs more than one operator — that depends on Phase 4 (a second real APW implementer) and on people installing Portaless without the author's help (Phase 5's exit criterion). **Portaless Cloud Images** had its cryptographic base implemented in v0.0.9.10 (signed sidecars, PNG embedding, upload/serve/verification endpoints — `docs/architecture/cloud-images.md`); what remains external is large-image storage (R2) and moderation.

---

## Security

See [`SECURITY.md`](./SECURITY.md) for known and active vulnerabilities in this MVP, including the handling of the real `isolated-vm` CVE (GHSA-864f-rcv7-6rh4) and the current limitations of the Trust Layer's cryptographic verification. To report a vulnerability, do not open a public Issue — contact the maintainers directly.

---

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENT.md`](./AGENT.md) (the latter especially if you're using an AI agent to contribute — it contains the real status map of every module). Every change goes through a branch and Pull Request, never a direct commit to `main`.

---

## License

[AGPL-3.0](./LICENSE) for the project's core — install it, modify it, and use it freely; if you offer a modified version as a service to third parties, share those changes back. Third-party plugins, including closed-source ones, are governed by [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md), not by this license. The Protocol APW specification is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

<div align="center">

**Portaless** — fewer isolated portals, more real ease to build the ones worth building.

</div>
