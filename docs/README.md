# Portaless documentation index

> These documents are also published as a site at **`/docs/`** (grouped as Getting started, Guides, Reference and Concepts). The site is a **projection** of the Markdown in `docs/` — the files below are the single source, and only a curated subset is published (`src/lib/docs-nav.mjs`); the rest stays on GitHub.

> As of October 2026, **canonical documentation is English**. Spanish originals are preserved intact as `*_es.md` archives (nothing was deleted); where an archive and the English file disagree, the English file wins. Some deeper design/history documents remain Spanish-only (marked below) — translations are welcome as contributions.

## Start here

| Document | Language | What it is |
|---|---|---|
| [`START_HERE.md`](./START_HERE.md) | English | **The shortest path**: three free accounts (GitHub + an AI with MCP + Cloudflare) from zero to a verifiable site you edit with an agent |
| [`../README.md`](../README.md) | English | Project overview, features, install |
| [`glossary.md`](./glossary.md) | English | Shared vocabulary: APW, LTP, SVRI, HSVR, T1–T5, Veracier, Cloudum and the evidence-first terms |
| [`../ROADMAP.md`](../ROADMAP.md) | English (concise) | Source of truth for current status. Spanish long-form archive: `ROADMAP_es.md` |
| [`../AGENT.md`](../AGENT.md) | English | Context + real-state table for AI agents working on this repo. Spanish archive: `AGENT_es.md` |
| [`../CHANGELOG.md`](../CHANGELOG.md) | English | Version history. Spanish archive (frozen): `CHANGELOG_es.md` |
| [`testing/release-acceptance.md`](./testing/release-acceptance.md) | English | C40–C41 release evidence: clean install, builds, upgrade/restore, privacy negative test, publication, mobile and resources; external gates still open |
| [`../SECURITY.md`](../SECURITY.md) · [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | English | Security policy · contribution guide (Spanish archives: `*_es.md`) |
| [`mvp/acceptance-contract.md`](./mvp/acceptance-contract.md) | English | Accepted target contract for private data, local/Cloudum canonical node, public projections, ChatGPT/OpenAI compatibility, resource budget and 320px navigation |
| [`testing/INTEROPERABILITY.md`](./testing/INTEROPERABILITY.md) | English | C31–C33: MCP connection profile, OpenAI-compatible provider subset, and the local/external acceptance evidence matrix |
| [`openai-compatible-provider.md`](./openai-compatible-provider.md) | English | How to configure and check the OpenAI-compatible provider, including the minimal Python mock; explicit subset and external-verification limits |
| [`private-node.md`](./private-node.md) | English | C37–C39: minimal/private Docker profiles, Tailscale, backups and the resource budget |

## LTP Stack — APW, LTP Index, SVRI/HSVR — [`protocol-apw/`](./protocol-apw/)

Protocol contracts (CC BY 4.0), separate from their reference implementation
(`packages/apw-resolver/`, AGPL-3.0). See the
[LTP Stack architecture](./protocol-apw/LTP-STACK-ARCHITECTURE.md) for identity,
trust/traceability and output/history responsibilities; paths retain their
historical names until a separately approved repository migration.

| Document | Language | Status |
|---|---|---|
| [`protocol-apw/README.md`](./protocol-apw/README.md) | English | Protocol overview, Veranet vision, license/governance, real status |
| [`protocol-apw/APW-SPEC-v1.3.md`](./protocol-apw/APW-SPEC-v1.3.md) | English (canonical) | **Published consolidated specification** — APW identity/state structure, LTP witness/evidence evaluation and scoring, SVRI/HSVR contracts; current LTP Index witness-directory representation |
| [`protocol-apw/APW-VECTORS-v1.3.md`](./protocol-apw/APW-VECTORS-v1.3.md) | English (canonical) | **Test vectors** V-01..V-13 for independent implementations |
| [`protocol-apw/APW-SPEC-v1.3_es.md`](./protocol-apw/APW-SPEC-v1.3_es.md) · [`APW-VECTORS-v1.3_es.md`](./protocol-apw/APW-VECTORS-v1.3_es.md) | Spanish archives | Full-context Spanish copies of the current normative set |
| [`protocol-apw/ERRATA.md`](./protocol-apw/ERRATA.md) | Spanish (historical) | Errata E-1..E-10; integrated into v1.3 |
| [`protocol-apw/APW-SPEC-v1.2.md`](./protocol-apw/APW-SPEC-v1.2.md) · [`APW-SPEC-v1.0.md`](./protocol-apw/APW-SPEC-v1.0.md) · [`apw-spec.md`](./protocol-apw/apw-spec.md) | Spanish (historical) | Superseded versions / citable prior art / conceptual summary |

## Integrator guide — [`api/`](./api/)

For third parties connecting to APW / Portaless / Index HTTP APIs.

| Document | What it covers |
|---|---|
| [`api/README.md`](./api/README.md) | Surface overview, auth model, 60-second end-to-end verification recipe |
| [`api/well-known.md`](./api/well-known.md) | The 8 public `/.well-known/*` endpoints + `GET /trust/:siteId`, response shapes, pagination, error codes |
| [`api/admin.md`](./api/admin.md) | Admin API catalog (witness record, Index sync/subjects, reader-conduct emit, SiteTrustScore management, …) |

## Architecture — [`architecture/`](./architecture/)

Mostly Spanish (design-era documents); verify claims against `AGENT.md`'s status table — some predate the module implementations.

- [`architecture/canonical-node-and-public-projections.md`](./architecture/canonical-node-and-public-projections.md) (English) — target contract for the private canonical node, approved public projections, local/Cloudum handover, and public revision evidence. Explicitly distinguishes target behavior from current implementation.
- [`architecture/public-revision-history.md`](./architecture/public-revision-history.md) (English) — implemented PageStore revision IDs, approved history/export/import and the unsigned/APW no-data limits.
- [`decisions/`](./decisions/README.md) (English) — accepted architecture decisions and their known risks/conditions for reconsideration.

- `REPO_STRUCTURE_MAP.md` (ES) — why the real repo structure differs from the original proposal (stub claims corrected).
- `site-trust-score.md`, `authentication.md`, `licensing-boundaries.md`, `ecosystem-boundaries.md`, `content-layer.md`, `persistence.md`, `deployment-engine.md`, `identity-atproto.md`, `cloud-images.md`, `mcp-agents.md`, `commerce-plugin.md`, `creator-sites-agentic-workflow.md`, `server-side-role-checks.md`, `seo-geo.md` (ES) — per-area design docs.

## Operations and history

- [`self-hosting.md`](./self-hosting.md) · [`self-hosting-verification.md`](./self-hosting-verification.md) (ES) — self-host guides.
- [`testing/disposable-staging.md`](./testing/disposable-staging.md) (English) — isolated local staging fixture, synthetic data and ownership-checked cleanup.
- [`DEPLOY_CLOUDFLARE_PAGES.md`](./DEPLOY_CLOUDFLARE_PAGES.md) · [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md) · [`COMMERCE_SETUP.md`](./COMMERCE_SETUP.md) (ES) — deployment/commerce setup.
- [`roadmap/ROADMAP-ARCHIVE.md`](./roadmap/ROADMAP-ARCHIVE.md) (ES) — PR-by-PR roadmap history (#1..#75).
- [`roadmap/v0.0.9.30-estado.md`](./roadmap/v0.0.9.30-estado.md) (ES) — historical release-state note.

## Other

- [`plugin-author-guide.md`](./plugin-author-guide.md) — write a sandboxed, closed-source plugin: manifest, capabilities (granted vs backend), the entry contract, storage limits, signing, install, licensing.
- [`veracier-onboarding.md`](./veracier-onboarding.md) — investigation + proposal for §15.2: what "become a Veracier" requires, and the open private-key-handling decision. No UI yet.
- [`i18n-design.md`](./i18n-design.md) — native internationalization: the model, the classification, and the minimal i18next-compatible MVP (locale routes, resources, `hreflang`).
- [`whitepaper/portaless-whitepaper.md`](./whitepaper/portaless-whitepaper.md) (ES) — original product vision (much of it design, not built code).
- Package-level docs: see each `packages/*/docs/` and `packages/*/README.md` (mixed ES/EN; `packages/apw-resolver/README.md` is English).
- Examples: [`../examples/`](../examples/) · Infra: [`../infra/`](../infra/) · Setup script: [`../scripts/SETUP.md`](../scripts/SETUP.md) (ES).
