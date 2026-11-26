# Release acceptance — C40–C41

**Candidate: `v0.0.11`.** **Status: local release evidence passed on 2026-10-21.** This page records what
the version demonstrates and what it does not. Machine-readable evidence:
[`release-evidence.json`](./release-evidence.json). The external ChatGPT,
OpenAI-compatible provider and Cloudum checks are still open; local fixtures do
not stand in for them.

## What was executed

```bash
npm run test:release
```

The command runs, in order:

1. a temporary `npm ci` from `package-lock.json`;
2. the complete Vitest suite;
3. the synthetic private-export negative test;
4. the npm source-package boundary check;
5. a normal Astro build;
6. a build with `PORTALESS_BASE_PATH=/portaless/` into a temporary output directory;
7. the resource-budget fixture;
8. the complete Playwright suite;
9. `git diff --check`.

`test:release` is implemented by [`scripts/verify-release.mjs`](../../scripts/verify-release.mjs).
The `Release acceptance` GitHub workflow runs the same command on `v*` tags and
on manual dispatch.

## Local results

| Evidence | Result |
|---|---|
| Clean install from lockfile | **PASS** — temporary `npm ci`, workspace manifests copied, `astro` present |
| Normal build | **PASS** — 79 pages |
| Build with `/portaless/` base | **PASS** — 79 pages; output carries the base |
| Unit + e2e | **PASS** — 241 files, 2,105 tests, 1 skipped |
| Playwright | **PASS** — 72 tests |
| Private-export negative test | **PASS** — synthetic page/post/archive/DB markers absent from every artifact |
| Source/package and Docker boundaries | **PASS** — local boundary checks; Docker boundary is covered by CI |
| Publication / unpublish | **PASS** — approval snapshot, idempotence, stale retry, tombstone |
| Historical upgrade | **PASS** — v1 snapshot migrates to current schema; backup, ledger, columns and seeded data verified |
| Local backup / restore | **PASS** — checksums, secret exclusion, single-writer activation |
| Resource budget | **PASS** — see below |
| `git diff --check` | **PASS** |

### Resource measurement

Fixture: 200 pages × 5 published revisions = **1,000 revisions**, local SQLite.

| Metric | Value |
|---|---|
| Seed | 738 ms |
| SQLite canon | 1,810,432 bytes (~1.73 MiB) |
| Backup | 1,810,432 bytes, 10 ms |
| Restore | 8 ms, 200 pages / 1,000 revisions |
| Node RSS | 100,777,984 bytes (~96.1 MiB) |
| Budget | 2 GiB RSS / 20 GiB disk |
| Result | **PASS**, no violations |

This is a local reference fixture, not a Cloudum SLA and not a guarantee for a
different dataset.

## Post-release audit hardening

The final audit added and verified:

- IPv4-mapped IPv6 literals (`[::ffff:127.0.0.1]`, canonicalized by WHATWG to
  `[::ffff:7f00:1]`) are rejected as private egress destinations.
- A 100-concurrent-consumer regression for the per-plugin email quota.
- Escrow replay/iat-window and SVRI key-window regressions.
- `migrate:d1` writes the ledger row as the last statement of each delta and
  takes a local advisory lock; the lock is not distributed.
- A pre-versioned database missing `att_jws` is rejected for adoption.
- Proposal diffs are rendered as escaped text (`textContent`), with a source
  regression test.
- Glossary, ADR 0002 (DNS rebinding/egress) and the release/changelog cleanup.

The follow-up `audit/v0.0.11-consistency` branch (not re-tagged) additionally
moves the Web Bot Auth key-directory fetch onto the hardened `createSafeFetcher`
path (private/loopback/metadata targets and private redirect hops blocked, 5 s
timeout, 512 KiB cap), reports `enforced` in `/admin/api/agents`, corrects the
published capability count to 5 of 12 still at `501` (`network:fetch` is an
adapter path, not a host-bridge backend), and expands this repository's security
review guide. Round 2 adds Node DNS pinning for the directory fetch, a 60 s
bounded negative cache (LRU 256), an in-flight cap of 8, the Beta/invite-only
status wording, and the search-bot/cooperative-signal regressions. Its local
validation is **247 files / 2,147 tests / 2 skipped, 72 Playwright, 79 pages**.
The `v0.0.11` evidence above remains the tagged snapshot (241 / 2,105); it is
not retroactively rewritten.

## `v0.1.0-rc.2` candidate update (2026-11-26)

Verified on `main` (`adff328`, Node 24 CI 9/9 checks + `Release acceptance` run `45867098883` green + live `starter` self-host smoke):

- **Automated `Release acceptance` workflow (`45867098883`):** **PASS** on `main` after PR #141 (`lockfile-install`, full Vitest, private-export negative, source boundary, `verify:claims`, `starter` + `/portaless/` + `demo` builds, resource budget, full Playwright suite, `git diff --check`).
- **UX & runtime additions (PRs #141–#144):** 3-tier `/admin` hierarchy with native collapsed `<details>` for advanced protocol tools, sequential 4-step `/admin/wizard`, editable home page (`/`) via Visual Editor (`functions/index.js` with non-destructive static fallback), preventive `buildRuntimeAvailable` notice in `/admin/publish`, and aligned onboarding guides (`START_HERE.md`, `DEPLOY_GITHUB_PAGES.md`, `first-steps.md`, `DEPLOY_CLOUDFLARE_PAGES.md`).
- **Live `starter` self-host smoke (`server/node-runtime.mjs` + compiled `starter` `dist/` + temporary SQLite):** verified `GET /` static starter fallback (`200`, strict `script-src 'self' https:`), published `slug="home"` dynamic rendering at `/` (`200`, strict CSP), automatic fallback restoration on draft revert (zero draft leak), and authenticated `GET /admin/api/publication` reporting `buildRuntimeAvailable: true`.
- **Unit & browser suites:** 254 unit files / 2,258+ tests / 1 skipped, 76 Playwright tests (0 CSP violations), dual builds (`starter` 37 pages + `demo` 79 pages), `npm run verify:claims` (`READY` + 11 suites / 57 tests).
- **External gates:** All 5 external release-acceptance gates below remain open (`blocked_unverified` / `not_run` / `pending`).

## `v0.1.0-rc.1` candidate update (2026-11-26)

Verified on `main` (`b82eb1e`, Node 24 CI 9/9 checks + local staging):

| Evidence | Result |
|---|---|
| `npm run verify:claims` (`check:boundaries --strict` + 11 suites) | **PASS** — 0 boundary/license/pin violations, 7 `@verared/*@0.1.0-rc.1` packages verified with `sha512` on `registry.npmjs.org`, `@verared/spec` / `@portaless/plugin-sdk` / `@portaless/templates` on immutable GitHub Release tarballs |
| Unit + e2e (Node 24 CI) | **PASS** — 252 files, 2,248+ tests, 1 skipped |
| Playwright E2E (Node 24 CI, incl. `csp-no-violations.spec.ts`) | **PASS** — 76 tests, 0 CSP violations (`script-src 'self' https:`) |
| Dual Astro builds | **PASS** — `starter` 37 pages (`/`, `/pages/starter-guide/`), `demo` 79 pages (`deploy-demo-pages.yml` green) |
| Live staging (`shadow` → fail-closed `enforce` → configured `enforce`) | **PASS** — compiled `starter` artifact on `server/node-runtime.mjs` + migrated SQLite: strict CSP, `/healthz` `200 no-store`, real admin login/logout revocation, `/admin/api/gatekeeper-status` (0 secret leak), `503 email_backend_unavailable`, B3 public `200` vs governed `403`, invalid signature `401`, fail-closed `503 gatekeeper_misconfigured` without HMAC secret |

Main branch protection is a GitHub setting, verified separately from this
repository evidence.

## Guarantees and evidence

| Guarantee | Status | Evidence |
|---|---|---|
| A draft is not public | **Passed locally** | Runtime route returns `404 no-store`; build/export and browser tests; synthetic markers absent from every `dist` artifact |
| The ledger describes real changes | **Passed locally** | Historical upgrade verifies schema, seeded page and skin values, not only the version number |
| Edit permission does not grant publication | **Passed locally** | MCP proposal/approval and publish-gate tests |
| Secrets do not travel with the site | **Passed locally** | Private-export negative test, private-artifact scan and npm source boundary |
| History travels between publishers | **Passed in fixtures** | Revision IDs/hashes and import tests; a real GitHub account publish is still external |
| Reputation belongs to a revision | **Partial** | Revision/evidence storage exists, but page-specific APW observations remain `no_data`; site-level scores are not attributed to a page hash |
| The menu occupies one row | **Passed locally** | Playwright at 320×480/320×568 and 44px target tests |
| The node fits the budget | **Passed locally** | Resource fixture above |
| Local and Cloudum are equivalent | **Partial** | Local backup/restore and single-writer activation pass; Cloudum hosting, operator access and cross-host handover are external |
| ChatGPT really works | **Blocked** | No external account/workspace, client, model and HTTPS tunnel were available |

## External checks still open

These are **not** converted to `passed` by a local fixture:

- **ChatGPT custom MCP write flow** — `blocked_unverified`. Requires the exact
  account/workspace plan, client version, model, HTTPS/tunnel origin, tool
  discovery snapshot and request IDs. Registry:
  [`interop-evidence.json`](./interop-evidence.json).
- **External OpenAI-compatible provider** — `not_run`. Requires a real key,
  endpoint and model. The local contract and loopback mock only prove the
  client path. See [`openai-compatible-provider.md`](../openai-compatible-provider.md).
- **Cloudum** — `not_run`. Its access controls, key custody, backups and handover
  are provider responsibilities and are not verified by this repository.
- **Real GitHub account publish** — `not_run`. The adapter is fixture/mock-tested;
  a real repository publish must still be recorded.
- **Independent human review** — **pending**. The implementation agent can run a
  self-review, but that is not independent. A reviewer who did not implement the
  change must inspect the complete release diff before the release is described
  as independently reviewed.

## Privacy and release limits

- Local export tests prove that known private markers are excluded from the
  generated public projection. They do not prove that a secret deliberately
  committed to a public path was never public.
- If a secret was published, deleting it from the latest commit is not enough:
  revoke it and treat the historical exposure explicitly.
- Tailscale and a private Docker network restrict reachability. They do not
  prove that a host operator cannot read the mounted volume.
- A public artifact fetched by a third party cannot be guaranteed erased after
  unpublish.
