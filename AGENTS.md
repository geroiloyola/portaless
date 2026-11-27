# AGENTS.md — Context for AI coding agents (opencode, Claude Code, Cursor)

> This file is the **single entry point for any AI agent working on this repo**.
> Stack: Astro + TypeScript (no React/Vue), npm workspaces (`packages/*`).
> For live module status, always check [`ROADMAP.md`](./ROADMAP.md).

## What Portaless is (one paragraph)

A lightweight open-source CMS on Astro that compiles to static HTML. No paid
hosting required for the base case (GitHub Pages or Cloudflare Pages). Optional
modules: commerce, plugin sandboxing, AI-agent identification (Web Bot Auth),
MCP server (so an AI agent can edit pages directly), and a modular dashboard.
Core is AGPL-3.0; the Protocol APW spec is CC BY 4.0; the Vera Trust Stack packages (`verared`-bound L0-net/L1/L2) are Apache-2.0; the Plugin SDK is MIT.

**Local Trust Protocol** means each node applies its own policy to verified
evidence. **Vera Trust Stack** is APW + Local Trust Protocol + SVRI + HSVR; this
naming does not rename wire identifiers, paths or signed artifacts.

## The new-user story (this is the product's north star)

A person should be able to start in the APW/LTP world with **three free
accounts**:

1. **GitHub** — host the site on GitHub Pages (or Cloudflare Pages).
2. **An AI with MCP** — ChatGPT, Claude, Mistral, Perplexity, or any MCP
   client. The agent connects to Portaless's MCP server and can edit pages
   without the user touching a terminal.
3. **Cloudflare** — optional, for the Trust Layer (AI-agent identification
   with cryptographic signatures, pay-per-crawl, public SiteTrustScore).

The end-to-end path: fork → push → GitHub Actions builds and deploys → open
the admin panel → tell your AI agent (via MCP) to create your first page.
That's it. No paid hosting, no WordPress, no PHP.

## The documentation you actually need

Read in this order — **do not read them all**:

| When you need | Read |
|---|---|
| To understand what the product is and where it's going | `docs/VISION.md` |
| To know what's real today (per module) | `ROADMAP.md` |
| To install locally (Docker + browser, ~10 minutes) | `docs/first-steps.md` (Spanish) |
| To deploy to GitHub Pages | `docs/DEPLOY_GITHUB_PAGES.md` |
| To deploy to Cloudflare Pages (needed for Trust Layer) | `docs/DEPLOY_CLOUDFLARE_PAGES.md` |
| To self-host (Node/Docker/Railway/Render) | `docs/self-hosting.md` |
| To understand how an AI agent edits pages (MCP) | `docs/architecture/mcp-agents.md` |
| To write a third-party plugin | `docs/plugin-author-guide.md` |
| To read the API | `docs/api/README.md` |
| To understand the docs site | `docs/README.md` |
| To understand the accepted private-node/public-projection MVP contract | `docs/mvp/acceptance-contract.md` |
| To see what the release actually demonstrates (and what remains external) | `docs/testing/release-acceptance.md` |
| To review accepted architecture decisions and their open risks | `docs/decisions/README.md` |
| To know which LTP work is actually authorized (G1–G5) | `docs/protocol-apw/LTP-GATES-AND-AUTHORIZATIONS.md` |

## Real state

The per-module status table lives in one place only. Do not copy it here:

- [`ROADMAP.md`](./ROADMAP.md) — what is shipped, partial or open today (read before proposing).
- [`docs/README.md`](./docs/README.md) — documentation index and which repository owns what.

Headline facts an agent must not contradict: the MCP server exposes 19 tools (stdio + HTTP); the Plugin SDK is consumed from `@portaless/plugin-sdk`; 5 plugin capabilities still return explicit `501` by design; the plugin HTTP installer is off by default.

## What to read before proposing a new feature

1. `ROADMAP.md` — what's missing, prioritized, with owner (Portaless vs
   third-party).
2. `docs/VISION.md` — what the project refuses to become (so you don't propose
   something it explicitly rejects).

## Code conventions (the non-negotiables)

1. **Every new module is optional by default.** Toggling it off must never
   break the site. See `ENABLE_COMMERCE` / `ENABLE_TRUST_LAYER` in
   `functions/_middleware.js`.
2. **No plugin gets more capabilities than granted.** The rule lives in
   `packages/plugin-sandbox/src/runtime/sandbox-runtime.ts`: use what the
   Permissions Center *granted*, never what the manifest *requested* (full
   catalog: `packages/plugin-sandbox/src/capabilities/capability-registry.ts`).
   The MCP server enforces the same rule via `requireCapability()` in
   `packages/mcp-server/src/permissions/require-capability.ts`.
3. **Never declare something "implemented" if there's an integration `TODO`
   pending.** This project documents limitations honestly.
4. **The only surface a third-party plugin imports is `@portaless/plugin-sdk`**
   (MIT). No plugin may import core internals directly.
5. **All changes go through a Pull Request.** Never commit directly to `main`,
   even with merge permission. The project owner approves manually.

## How to verify your change

Run these in order. If any fails, don't commit.

```bash
# 1. Unit + e2e tests
node node_modules/vitest/vitest.mjs run

# 2. Production build (Astro)
npm run build
# Expect: ~59 pages, no errors.

# 3. Manifest validation
node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts

# 4. Browser tests (Playwright, real self-host runtime against dist/)
npx playwright test
# Expect: 39 passed. Runs serially (workers: 1) because flows mutate shared state.

# 5. Typecheck? There is none. Bugs surface through tests, not the compiler.
#    (No tsconfig; this is intentional — missing interface methods are caught
#    by runtime tests, not tsc.)
```

For local dev:

```bash
npm run dev           # Astro dev server (no functions)
npm run self-host:dev # Full runtime with SQLite (admin, login, /trust/:siteId)
```

## Active security risks (must-know before touching code)

- **`isolated-vm` ≤7.0.0** has an RCE (GHSA-864f-rcv7-6rh4). The code rejects
  vulnerable versions at instantiation — **do not remove that check**.
- **Permissions Center + traceability ledger** have real persistence (D1/SQLite).
  Their data is not disposable across deployments.
- **MCP server over stdio** uses a fixed per-process env identity (Option A).
  Do not assume cryptographic verification of who invokes each tool on stdio.
  HTTP transport (Option B) has per-invocation identity via bearer tokens.
- **`IP_HASH_SALT`** is required for community voting. Without it,
  `POST /trust/:siteId/vote` fails closed with `500 server_misconfigured`.

## Project structure (the parts you'll touch)

```
src/                          # Astro site (pages, content, layouts)
packages/
  atomic-elements/            # Visual editor (17 elements, theme packs)
  dashboard/                  # Admin panel + Skin System + activity feed
  permissions/                # Permissions Center
  plugin-sandbox/             # Multi-provider sandboxing + capability bridge
  plugin-sdk/                 # MIT SDK for third-party plugin authors
  trust-layer/                # AI agent ID + SiteTrustScore + pay-per-crawl
  apw-resolver/               # Protocol APW reference implementation
  mcp-server/                 # Native MCP server (19 tools)
  auth/                       # Login, roles, 2FA, OAuth, persistence
functions/                    # Cloudflare Pages Functions (middlewares, APIs)
server/                       # Self-hosted Node runtime (mirrors functions/)
scripts/                      # Setup, schema generation, Docker entrypoint
docs/                         # Vision, whitepaper, APW spec, deploy guides
```

See `docs/architecture/REPO_STRUCTURE_MAP.md` if something is not where you
expected.

## Branching

- The project works on **`main`** (single branch). Feature branches are not the
  norm unless the project owner explicitly asks.
- PRs go from a feature branch → `main`. The owner reviews and merges.

## Changelog + roadmap

- `CHANGELOG.md` — what shipped, version by version.
- `ROADMAP.md` — what's missing today, prioritized. **Read before proposing.**
- `docs/archive/ROADMAP-ARCHIVE.md` — immutable history (PRs #1–#75).
