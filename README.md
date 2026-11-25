<div align="center">

# Portaless

**Less Portals, More Simplicity**

A lightweight, open source, modular CMS node — built on Astro to compile to static HTML without paid hosting, with sandboxed plugins and cryptographic control over AI readers.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-5A6B24?style=flat&labelColor=261C15)](./LICENSE)
[![Status: Beta, invite-only](https://img.shields.io/badge/status-beta%20%2F%20invite--only-5A6B24?style=flat&labelColor=261C15)](./ROADMAP.md)
[![Astro](https://img.shields.io/badge/built%20with-Astro-6E6653?style=flat&labelColor=261C15)](https://astro.build)
[![Protocol APW](https://img.shields.io/badge/protocol-APW%20v1.3-5A6B24?style=flat&labelColor=261C15)](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/APW-SPEC-v1.3.md)

[Vision](./docs/VISION.md) · [Roadmap](./ROADMAP.md) · [Live demo](https://geroiloyola.github.io/portaless-templates/) · [Architecture](./ARCHITECTURE.md) · [API guide](./docs/api/README.md) · [Docs index](./docs/README.md) · [Security](./SECURITY.md) · [Licensing](./docs/architecture/licensing-boundaries.md) · [Contributing](./CONTRIBUTING.md)

> **New here?** Start with [`docs/START_HERE.md`](./docs/START_HERE.md) — the three-free-accounts path (GitHub + an AI with MCP + Cloudflare). For the official live showcase and fictional templates, visit [`geroiloyola/portaless-templates`](https://github.com/geroiloyola/portaless-templates) ([live demo](https://geroiloyola.github.io/portaless-templates/)).

</div>

---

## What is Portaless?

**Vera Trust Stack** is APW + Local Trust Protocol + SVRI + HSVR. **Local Trust Protocol** means each node applies its own policy to verified evidence. See the [glossary](./docs/glossary.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for layer boundaries.

This repository is the **sovereign reference CMS node** (`starter` profile by default):

- **Clean starter site out of the box** (`site-profiles/starter/`): `npm run build` emits a minimal English static site (35 pages, zero demo/marketing pages) ready for GitHub Pages, Cloudflare Pages, or self-hosted Node/Docker.
- **Native visual editor (Atomic Elements)** + modular dashboard with swappable skins (17 elements, 6 skins).
- **Sandboxed plugins with atomic permissions** (`isolated-vm` + edge adapters): 7 of 12 plugin capabilities have a real execution path; five plugin capabilities still answer an explicit `501` by decision. Third-party plugins import [`@portaless/plugin-sdk`](https://github.com/geroiloyola/portaless-plugin-sdk) (MIT) only.
- **Granular control over AI agents**: cryptographic bot identification (Web Bot Auth), pay-per-crawl policies, and a public traceability ledger via [`@verared/*`](https://github.com/verared/vera-trust-stack). You decide, from the panel, the terms for search engines, AI assistants and model training. The site publishes them in writing and enforces the AI-input rule on signed agent requests; search and training remain cooperative signals (not enforced per request).
- **Native MCP server** (19 tools, stdio + HTTP per-invocation bearer tokens) and an optional server-side OpenAI-compatible provider subset ([connection guide](./docs/openai-compatible-provider.md)).
- **Account security**: `admin`/`viewer` roles, persistent TOTP 2FA, password recovery, OAuth/SSO, and step-up verification.

> **Current status: Beta, invite-only.** Single maintainer ([`SECURITY.md`](./SECURITY.md#bus-factor-single-maintainer-risk)); plugin installer is behind a flag (`PORTALESS_PLUGIN_INSTALLER`) off by default pending external sandbox review; local release evidence is recorded in [`docs/testing/release-acceptance.md`](./docs/testing/release-acceptance.md) (ChatGPT, external OpenAI-compatible endpoints, Cloudum equivalence, and independent review remain open).

---

## Ecosystem (5 connected gears)

Portaless is assembled from five independent repositories with strict unidirectional boundaries and zero registry tokens required (`npm ci` and Docker consume pinned GitHub Release tarballs):

| Repository | Role | License |
|---|---|---|
| [`verared/vera-trust-spec`](https://github.com/verared/vera-trust-spec) | Normative specification, JSON schemas & conformance vectors (`@verared/spec`) | **CC BY 4.0** |
| [`verared/vera-trust-stack`](https://github.com/verared/vera-trust-stack) | Neutral reference implementation (`@verared/*`, L0-net/L1/L2) | **Apache-2.0** |
| [`geroiloyola/portaless-plugin-sdk`](https://github.com/geroiloyola/portaless-plugin-sdk) | Third-party plugin types, manifest validator & capability catalog (`@portaless/plugin-sdk`) | **MIT** |
| [`geroiloyola/portaless-templates`](https://github.com/geroiloyola/portaless-templates) | Official fictional demo profile, templates, 21 original SVGs & live demo (`@portaless/templates`) | **CC0-1.0** |
| **`geroiloyola/portaless`** *(this repo)* | Sovereign reference CMS node (`starter` default) | **AGPL-3.0-or-later** |

---

## Live Demo & Site Profiles (`starter` vs `demo`)

- **Live official demo (no install needed):** [geroiloyola.github.io/portaless-templates](https://geroiloyola.github.io/portaless-templates/) — built and deployed from [`geroiloyola/portaless-templates`](https://github.com/geroiloyola/portaless-templates). GitHub Pages serves static HTML only; admin, login, and dynamic `/trust/:siteId` require self-hosting or Cloudflare Pages.
- **Default local build (`starter`):**
  ```bash
  npm ci
  npm run build          # builds site-profiles/starter/ (35 pages, clean EN site)
  ```
- **Optional showcase build (`demo`):**
  ```bash
  PORTALESS_SITE_PROFILE=demo npm run build   # builds @portaless/templates demo (79 pages)
  ```
- Any unknown `PORTALESS_SITE_PROFILE` value aborts the build immediately and never falls back to `demo`.

---

## Quick Start (Node 24+)

> **Non-technical?** Follow [`docs/first-steps.md`](./docs/first-steps.md) (Spanish, Docker + browser, ~10 minutes).

### Prerequisites
- **Node.js ≥ 24** (required by `isolated-vm@7` and `better-sqlite3`) and **Git**.

```bash
git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm ci

# Static dev server (starter profile)
npm run dev

# Full self-hosted runtime (admin panel, SQLite, login, /trust/:siteId)
npm run setup          # creates SQLite schema + first admin user
npm run self-host:dev  # http://localhost:3000
```

---

## Deployment

- **GitHub Pages (static `starter`):** [`docs/DEPLOY_GITHUB_PAGES.md`](./docs/DEPLOY_GITHUB_PAGES.md)
- **Cloudflare Pages + D1 (static + Functions / Trust Layer):** [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](./docs/DEPLOY_CLOUDFLARE_PAGES.md)
- **Self-hosting (Node, Docker, Compose, Railway, Render):** [`docs/self-hosting.md`](./docs/self-hosting.md)

---

## Verification

```bash
npm run check:boundaries                                   # --strict architecture & license gate
npm run verify:claims                                      # boundaries + claims, honesty, links & runtime parity
npm test                                                   # Vitest unit + e2e suite
npm run build                                              # starter profile build (35 pages)
PORTALESS_SITE_PROFILE=demo npm run build                  # demo profile build (79 pages)
node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts
PORTALESS_SITE_PROFILE=demo npx playwright test            # 75 browser regressions
```

---

## Documentation & Governance

- **Current module state & open work:** [`ROADMAP.md`](./ROADMAP.md) · [`AGENT.md`](./AGENT.md) · [`CHANGELOG.md`](./CHANGELOG.md)
- **Product direction:** [`docs/VISION.md`](./docs/VISION.md)
- **Architecture & boundaries:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md)
- **Plugin authoring:** [`docs/plugin-author-guide.md`](./docs/plugin-author-guide.md) · [`@portaless/plugin-sdk`](https://github.com/geroiloyola/portaless-plugin-sdk)
- **Security & disclosure:** [`SECURITY.md`](./SECURITY.md)

## License

Core node and CMS are licensed under **AGPL-3.0-or-later** ([`LICENSE`](./LICENSE)). External gears carry their own compatible licenses as listed in the ecosystem table above; see [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md).
