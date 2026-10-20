# Portaless documentation index

> As of October 2026, **canonical documentation is English**. Spanish originals are preserved intact as `*_es.md` archives (nothing was deleted); where an archive and the English file disagree, the English file wins. Some deeper design/history documents remain Spanish-only (marked below) — translations are welcome as contributions.

## Start here

| Document | Language | What it is |
|---|---|---|
| [`VISION.md`](./VISION.md) | English | **Direction** — what Portaless must become and what it refuses to become. Carries no status, versions, dates or file paths, on purpose: it does not go stale. `ROADMAP.md` wins on state; this file wins on direction |
| [`../README.md`](../README.md) | English | Project overview, features, install |
| [`../ROADMAP.md`](../ROADMAP.md) | English (concise) | Source of truth for current status and next work. Spanish long-form archive: `ROADMAP_es.md` |
| [`../AGENT.md`](../AGENT.md) | English | Context + real-state table for AI agents working on this repo. Spanish archive: `AGENT_es.md` |
| [`../CHANGELOG.md`](../CHANGELOG.md) | English | Version history. Spanish archive (frozen): `CHANGELOG_es.md` |
| [`../SECURITY.md`](../SECURITY.md) · [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | English | Security policy · contribution guide (Spanish archives: `*_es.md`) |

## Protocol APW and Portaless Index — [`protocol-apw/`](./protocol-apw/)

The open standard (CC BY 4.0) and its reference implementation (`packages/apw-resolver/`, AGPL-3.0).

| Document | Language | Status |
|---|---|---|
| [`protocol-apw/README.md`](./protocol-apw/README.md) | English | Protocol overview, Veranet vision, license/governance, real status |
| [`protocol-apw/APW-SPEC-v1.3.md`](./protocol-apw/APW-SPEC-v1.3.md) | English (canonical) | **Normative specification** — identity, signed artifacts, chained history, witnesses (§5.7), Loyal Trust Protocol (§6), Annex A scoring, Portaless Index aggregator |
| [`protocol-apw/APW-VECTORS-v1.3.md`](./protocol-apw/APW-VECTORS-v1.3.md) | English (canonical) | **Test vectors** V-01..V-16 for independent implementations, with machine-readable fixtures in [`protocol-apw/vectors/v1.3/`](./protocol-apw/vectors/v1.3/) that run executably in CI (**110/110 cases**) |
| [`protocol-apw/APW-SPEC-v1.3_es.md`](./protocol-apw/APW-SPEC-v1.3_es.md) · [`APW-VECTORS-v1.3_es.md`](./protocol-apw/APW-VECTORS-v1.3_es.md) | Spanish archives | Full-context Spanish copies of the current normative set |
| [`protocol-apw/ERRATA.md`](./protocol-apw/ERRATA.md) | Spanish | Errata **E-1..E-15**. E-1..E-10 are integrated into v1.3; **E-11..E-15 are normative, in effect and not yet consolidated** into the spec body (E-13 signed community attestations, E-14 the signed pages document, E-15 the signed plugin manifest are the most recent) |
| [`protocol-apw/APW-SPEC-v1.2.md`](./protocol-apw/APW-SPEC-v1.2.md) · [`APW-SPEC-v1.0.md`](./protocol-apw/APW-SPEC-v1.0.md) · [`apw-spec.md`](./protocol-apw/apw-spec.md) | Spanish (historical) | Superseded versions / citable prior art / conceptual summary |

## Integrator guide — [`api/`](./api/)

For third parties connecting to APW / Portaless / Index HTTP APIs.

| Document | What it covers |
|---|---|
| [`api/README.md`](./api/README.md) | Surface overview, auth model, 60-second end-to-end verification recipe |
| [`api/well-known.md`](./api/well-known.md) | The 7 public `/.well-known/*` endpoints + `GET /trust/:siteId`, response shapes, pagination, error codes |
| [`api/admin.md`](./api/admin.md) | Admin API catalog (witness record, Index sync/subjects, reader-conduct emit, SiteTrustScore management, …) |

## Architecture — [`architecture/`](./architecture/)

Mostly Spanish (design-era documents); verify claims against `AGENT.md`'s status table — some predate the module implementations.

- `REPO_STRUCTURE_MAP.md` (ES) — why the real repo structure differs from the original proposal (stub claims corrected).
- [`canonical-node-and-public-projections.md`](./canonical-node-and-public-projections.md) (EN) — target contract for local/Cloudum private canonical nodes, allowlisted public Git projections, revision history and restore/handover.
- `site-trust-score.md`, `authentication.md`, `licensing-boundaries.md`, `ecosystem-boundaries.md`, `content-layer.md`, `persistence.md`, `deployment-engine.md`, `identity-atproto.md`, `cloud-images.md`, `mcp-agents.md`, `commerce-plugin.md`, `creator-sites-agentic-workflow.md`, `server-side-role-checks.md`, `seo-geo.md` (ES) — per-area design docs.

## Operations and history

- [`self-hosting.md`](./self-hosting.md) · [`self-hosting-verification.md`](./self-hosting-verification.md) (ES) — self-host guides.
- [`DEPLOY_CLOUDFLARE_PAGES.md`](./DEPLOY_CLOUDFLARE_PAGES.md) · [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md) · [`COMMERCE_SETUP.md`](./COMMERCE_SETUP.md) (ES) — deployment/commerce setup.
- [`roadmap/ROADMAP-ARCHIVE.md`](./roadmap/ROADMAP-ARCHIVE.md) (ES) — PR-by-PR roadmap history (#1..#75).
- [`roadmap/v0.0.9.30-estado.md`](./roadmap/v0.0.9.30-estado.md) (ES) — historical release-state note.

## Other

- [`whitepaper/portaless-whitepaper.md`](./whitepaper/portaless-whitepaper.md) (ES) — original product vision (much of it design, not built code).
- Package-level docs: see each `packages/*/docs/` and `packages/*/README.md` (mixed ES/EN; `packages/apw-resolver/README.md` is English).
- Examples: [`../examples/`](../examples/) · Infra: [`../infra/`](../infra/) · Setup script: [`../scripts/SETUP.md`](../scripts/SETUP.md) (ES).
