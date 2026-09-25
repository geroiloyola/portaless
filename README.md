<div align="center">

# Portaless

**Less Portals, More Simplicity**

A lightweight, open source, modular CMS — built to be published without paid hosting, without plugins that break your site, and with real control over which AI agents can access your content.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-alpha%20%2F%20MVP-orange.svg)](./ROADMAP.md)
[![Astro](https://img.shields.io/badge/built%20with-Astro-ff5a03.svg)](https://astro.build)

[Roadmap](./ROADMAP.md) · [Whitepaper](./docs/whitepaper/portaless-whitepaper.md) · [Security](./SECURITY.md) · [Licensing](./docs/architecture/licensing-boundaries.md) · [Contributing](./CONTRIBUTING.md)

</div>

---

## What is Portaless?

Portaless is a CMS built on [Astro](https://astro.build) that solves, by architectural design, the most persistent structural problems of WordPress:

- **No exposed database, no server to manage** — the site compiles to static HTML and is served from free infrastructure (GitHub Pages, Cloudflare Pages).
- **Sandboxed plugins with atomic permissions**, instead of unrestricted access to the core (the root cause of 96% of WordPress's historical vulnerabilities).
- **Granular control over AI agents**: cryptographic bot identification, pay-per-crawl policies, and a public traceability ledger.
- **A native visual editor (Atomic Elements)**, designed to be radically lighter than Elementor.
- **A modular dashboard with swappable "skins"**, no CSS or PHP required.
- **Real account protection**: two-factor authentication, password recovery, and login via external providers (Google, GitHub, etc.).
- **Cross-site trust and discovery** via Protocol APW and a public `SiteTrustScore`, so independent Portaless instances can verify each other without any central authority.

> **Current status: alpha / MVP.** Not everything described in the whitepaper is implemented yet. Before using this in production, read the [Real status by module](#real-status-by-module) section and [`ROADMAP.md`](./ROADMAP.md).

---

## Table of contents

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
| **Atomic Elements** | Drag-and-drop visual page editor, without Elementor's DOM depth or page weight — includes 4 elements for sovereign link-in-bio pages (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`) |
| **Dashboard + Skin System** | Modular admin panel: each "skin" rearranges the same components via a JSON file, no code required |
| **Commerce (Medusa/Mercur)** | Optional module that consumes an external store's catalog — never reimplements checkout or payments |
| **Trust Layer** | AI agent identification (Web Bot Auth, RFC 9421/Ed25519), access policies (`allow`/`charge`/`block`), and a publicly queryable traceability ledger |
| **SiteTrustScore** | Public, multi-source trust score per site (`self`, `agent`, `community`, `escrow_report`), with admin UI to grant/revoke authorized agents and escrow providers without touching a terminal |
| **Protocol APW** | Cross-site discovery via DNS TXT record (`_apw.yourdomain.com`), resolved over DNS-over-HTTPS, with a manifest (`siteId`, `trustUrl`, `contentKinds`) and a CLI to publish it |
| **MCP server** | Native Model Context Protocol server — an AI agent can create/update pages, query the usage ledger, list installed plugins, and manage permissions directly |
| **Plugin Sandbox** | Multi-provider plugin isolation (Cloudflare, Deno Deploy, Fastly, or self-hosted via `isolated-vm`), with all 12 capabilities from the catalog wired to real code |
| **Permissions Center** | Atomic per-plugin/per-agent capability control, like the iOS/Android Privacy screen — connected to real persistence, with a community-driven `trustScore` badge per plugin |
| **Authentication** | Username/password login with roles (`admin`/`viewer`), two-factor authentication, password recovery, and login via external providers (OAuth/SSO) |

## Recent updates

A plain-language summary of what shipped across recent versions, for anyone who doesn't read `ROADMAP.md` line by line:

- **Cross-site trust and discovery now exist.** Any Portaless site can publish a signed, publicly resolvable manifest (Protocol APW) and expose a `SiteTrustScore` built from four independent sources — its own claims, verified AI agents, community votes, and third-party escrow reports. An admin can grant or revoke authorized agents and escrow providers entirely from the dashboard.
- **An AI agent can now run the whole site.** A native MCP server exposes real tools — creating and updating pages, querying the public usage ledger, listing installed plugins, granting or revoking permissions — so an agent like Claude can manage a Portaless site through conversation instead of a visual editor.
- **Four new elements for link-in-bio pages.** `ProfileHeader`, `LinkList`, `SocialIcons`, and `StoreBlock` let you replicate what paid link-in-bio tools offer, at zero cost, with your own domain and no third-party branding.
- **Plugins can now read and write site content for real.** Previously, granting a plugin permission to touch page content from the Permissions Center didn't actually do anything — only the "deny" path worked. Now the "allow" path works too, always inside the isolated sandbox.
- **Your admin account is better protected.** Two-factor authentication (the standard 6-digit code from an authenticator app), a password recovery flow, and login via external providers (Google, GitHub, or anything else you configure) — no separate password required.
- **Installing Portaless for the first time is one command.** Previously this meant applying 4 separate SQL files by hand and creating the admin user with a separate script. Now `npm run setup` does both in a single step (for self-hosted SQLite installs).
- **The license changed from MIT to AGPL-3.0.** This protects Portaless from being forked into a closed commercial service: anyone can install and use it for free, but if someone takes the code, modifies it, and offers it as a service to others, they must share those changes back. Third-party plugins (including paid or closed-source ones) carry no such obligation, because they run isolated from the core — see [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md) for the full breakdown.
- **The AI agent activity log is now publicly queryable.** The Trust Layer had been recording which AI agents visit your site for a while, but that data had no public view. It's now available at a public URL (`/.well-known/portaless-usage-log.json`), the same way the content policy already was.
- **The Permissions Center now actually saves changes.** Before, granting or revoking a permission from the panel was visual only and never persisted anywhere. Now it does, with the same "admin-only" protection as the rest of the panel.
- **Cloudflare Workers and Deno Deploy have real integrations** (not just a sketch) for running plugins on those providers' infrastructure, though neither has been verified against a real account yet — that final practical verification step is still pending.

## Real status by module

This project explicitly documents what's implemented versus what's a pending skeleton. Don't assume functionality from a folder name — check [`AGENT.md`](./AGENT.md) and [`ROADMAP.md`](./ROADMAP.md) for the live detail. Summary:

| Module | Status |
|---|---|
| Content engine, commerce (read), Atomic Elements, Dashboard | ✅ Functional |
| Authentication (login + D1/SQLite persistence + 2FA + password recovery + OAuth/SSO) | ✅ Functional — see pending integration note in [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) |
| Permissions Center | ✅ UI connected to real persistence (D1/SQLite) via `functions/admin/permissions/index.js`, with server-side guard `canWrite(role)` — plugin catalog now backed by a real dynamic registry with community `trustScore`, see [`PERMISSIONS_CENTER.md`](./packages/permissions/docs/PERMISSIONS_CENTER.md) |
| Trust Layer (policies + ledger) | ✅ Write path connected since v0.0.6, public read path connected in v0.0.9.3 via `GET /.well-known/portaless-usage-log.json` — see [`TRUST_LAYER_SETUP.md`](./packages/trust-layer/docs/TRUST_LAYER_SETUP.md) |
| SiteTrustScore (4 sources: self, agent, community, escrow_report) | ✅ All 4 sources have a connected HTTP endpoint; `agent` and `escrow_report` have a full admin lifecycle (grant/revoke UI, no manual API calls needed). Pending: both allowlists are empty by default, and there's no automated onboarding flow for a second escrow provider yet |
| Protocol APW (cross-site discovery via DNS TXT) | ✅ Real resolution via DNS-over-HTTPS (Cloudflare 1.1.1.1), manifest format, and a publishing CLI. Pending: `did:web`/`did:apw` and consumption from a future Portaless Index |
| MCP server | ✅ 6 real tools connected end-to-end (`list_page_components`, `query_usage_log`, `list_installed_plugins`, `create_page`, `update_page`, `grant_capability`, `revoke_permission`). Known limitation: agent identity is resolved once per process, not per call — documented as an active security consideration in `AGENT.md` |
| Plugin sandboxing (4 adapters) | 🟡 `isolated-vm` (self-hosted) runs real code with an isolate pool and **12/12 capabilities with a real bridge**; Cloudflare Workers for Platforms and Deno Deploy make real calls to their APIs (not yet verified against a real account, only tested with mocked `fetch`); Fastly remains contract + detailed TODOs only, no real API call yet |
| Web Bot Auth cryptographic verification | ✅ Validates Ed25519 signatures (RFC 9421) with key-directory caching and nonce-uniqueness checks |
| Installation / setup | ✅ Single command (`npm run setup`) for self-hosted SQLite — Cloudflare D1 still uses `wrangler d1 execute` separately |
| Native AT Protocol identity, Portaless Cloud Images, Portaless Index | ❌ Design/spec stage only, or not started |

---

## Installation

### Prerequisites

- **Node.js ≥ 20** (**22.5+** recommended if you want self-hosted SQLite persistence via `node:sqlite`, with no compiled dependencies).
- **Git**.
- A **GitHub** or **Cloudflare** account if you plan to deploy (both have free tiers that are sufficient).

### macOS

```bash
# Install Node.js (via Homebrew)
brew install node@22

# Clone the repository
git clone https://github.com/geroiloyola/portaless.git
cd portaless

# Install dependencies (uses npm workspaces for packages/*)
npm install
```

### Linux

```bash
# Debian/Ubuntu — install Node.js 22.x via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Fedora/RHEL
sudo dnf install nodejs git

# Clone and install
git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

### Windows

**Recommended: WSL2** (Windows Subsystem for Linux), to avoid path and permission issues with Astro and `node:sqlite`:

```powershell
wsl --install
```

Then, inside the WSL terminal (Ubuntu), follow the **Linux** steps above.

**Alternative without WSL** (PowerShell):

```powershell
# Install Node.js from https://nodejs.org (choose version 22 LTS)
# or via winget:
winget install OpenJS.NodeJS.LTS

git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

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

See the [Authentication](#authentication) section for the full detail, including the equivalent flow for Cloudflare D1.

---

## Configuration

All environment variables are optional — Portaless works out of the box, serving just the base static site.

| Variable | Module | Description |
|---|---|---|
| `ENABLE_COMMERCE` | Commerce | `true` to enable `/tienda` (requires `src/commerce/config.ts`, see [`docs/COMMERCE_SETUP.md`](./docs/COMMERCE_SETUP.md)) |
| `ENABLE_TRUST_LAYER` | Trust Layer | `true` to enable AI agent verification in `functions/_middleware.js` |
| `PORTALESS_ADMIN_USERNAME` / `PORTALESS_ADMIN_PASSWORD` | Authentication | Credentials for the first admin user, used by `npm run setup` |
| `PORTALESS_SQLITE_PATH` | Authentication | Path to a SQLite file for self-hosted persistence (requires Node 22.5+) |
| `PORTALESS_OAUTH_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` / `_AUTH_URL` / `_TOKEN_URL` / `_USERINFO_URL` | Authentication (OAuth/SSO) | Configuration for each external login provider (e.g. `PORTALESS_OAUTH_GOOGLE_CLIENT_ID`) — without this, login via that provider simply won't appear as an option |
| `PORTALESS_DEV_MODE` | Authentication (password recovery) | `1` so the recovery endpoint returns the token in the response, useful only for local development without a configured mail server |
| `DB` (binding, not a traditional env var) | Authentication, Permissions, Trust Layer, Pages | Cloudflare D1 binding, configured in `wrangler.toml` |

Copy `src/commerce/config.example.ts` to `config.ts` if you're enabling commerce.

---

## Project structure

```
portaless/
├── src/                    # Astro site (pages, content, layouts, commerce)
├── packages/
│   ├── atomic-elements/    # Visual page editor
│   ├── dashboard/          # Admin panel + Skin System
│   ├── permissions/        # Permissions Center
│   ├── plugin-sandbox/     # Multi-provider sandboxing
│   ├── trust-layer/        # AI agent identification + SiteTrustScore
│   ├── apw-resolver/       # Protocol APW: DNS-over-HTTPS resolver + manifest + publishing CLI
│   ├── mcp-server/         # Native MCP server (6 real tools connected)
│   ├── auth/               # Authentication (login, roles, 2FA, recovery, OAuth, persistence)
│   ├── commerce-plugin/    # Reference manifest for the commerce module
│   └── identity-atproto/   # Stub — not implemented
├── functions/              # Cloudflare Pages Functions (middlewares, login, OAuth, recovery, trust endpoints)
├── scripts/                # Setup (schema.sql + initial admin in one command)
├── docs/                   # Whitepaper, architecture, deployment guides, licensing boundaries, Protocol APW spec
├── examples/               # Reference configurations (blog, landing page, store)
├── tests/                  # Unit and e2e tests
└── ROADMAP.md              # Prioritized project status
```

See [`docs/architecture/REPO_STRUCTURE_MAP.md`](./docs/architecture/REPO_STRUCTURE_MAP.md) if you're looking for something and it's not where you'd expect.

---

## Deployment

### GitHub Pages (free)

Full guide: [`docs/DEPLOY_GITHUB_PAGES.md`](./docs/DEPLOY_GITHUB_PAGES.md). The workflow in `.github/workflows/ci.yml` builds the site automatically on every push to `main`.

### Cloudflare Pages (free, recommended if using Trust Layer or D1 authentication)

Full guide: [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](./docs/DEPLOY_CLOUDFLARE_PAGES.md). Required if you want to use `functions/` (middlewares, sandboxing, login, OAuth, password recovery, trust endpoints) — GitHub Pages doesn't support edge functions.

---

## Authentication

```bash
# Self-hosted with SQLite -- applies the database schema AND creates the
# first admin user, in a single command
PORTALESS_ADMIN_USERNAME=admin \
PORTALESS_ADMIN_PASSWORD=a-password-with-at-least-8-characters \
PORTALESS_SQLITE_PATH=./portaless.db \
npm run setup
```

Then visit `/admin/login`. From there you can also:

- Enable **two-factor authentication** (2FA) for your account.
- Recover your password if you forgot it, via `/admin/password-reset`.
- Log in with a configured external provider (`/admin/oauth/<provider>/start`), if you added its environment variables.

For Cloudflare D1, apply the schema with `wrangler d1 execute <DB_NAME> --file=schema.sql` — the first admin user is created automatically the first time the system detects that none exists.

See [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) for the full detail, including the honest limitations that remain (see [`ROADMAP.md`](./ROADMAP.md) for the exact status of each piece).

---

## Licensing

Portaless (the core: CMS, dashboard, authentication, Trust Layer, Permissions Center, sandbox engine) is distributed under **AGPL-3.0**. In plain terms: you can install it, use it, and modify it freely, even inside your own business — the only obligation kicks in if you take a modified version of the core and offer it as an online service to third parties, in which case you must share those changes back.

**Third-party plugins** (paid, free, or closed-source) carry no such obligation, as long as they run inside the isolated sandbox and only use the documented public API — this is the same principle that allows selling closed-source WordPress plugins. See [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md) for the full explanation, including FAQs for anyone building or selling plugins.

---

## Roadmap

The prioritized, up-to-date status of the project lives in [`ROADMAP.md`](./ROADMAP.md), organized into three categories:

- **Features in production** — already built, merged to `main`, and functional today.
- **Internal features in development** — still pending, but exclusively Portaless's responsibility, with no third-party dependency.
- **External features** — depend on a third party (payment companies, cloud providers, other open source projects) to be completed.

Two notable items currently in active design/spec work: a **one-click onboarding** flow so non-technical users can deploy a site via an AI agent without opening a terminal, and **Portaless Cloud Images**, a native APW-integrated image hosting layer where every published image carries a cryptographic signature, an existence timestamp, and the publisher's site identity as verifiable metadata.

---

## Security

See [`SECURITY.md`](./SECURITY.md) for known and active vulnerabilities in this MVP, including the handling of the real `isolated-vm` CVE (GHSA-864f-rcv7-6rh4) and the current limitations of the Trust Layer's cryptographic verification. To report a vulnerability, do not open a public Issue — contact the maintainers directly.

---

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENT.md`](./AGENT.md) (the latter especially if you're using an AI agent to contribute — it contains the real status map of every module). Every change goes through a branch and Pull Request, never a direct commit to `main`.

---

## License

[AGPL-3.0](./LICENSE) for the project's core — install it, modify it, and use it freely; if you offer a modified version as a service to third parties, share those changes back. Third-party plugins, including closed-source ones, are governed by [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md), not by this license.

---

<div align="center">

**Portaless** — fewer isolated portals, more real ease to build the ones worth building.

</div>
