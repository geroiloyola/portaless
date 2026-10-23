# Draft asset checks and main protection — observation and proposal

**Status: review note, 2026-10-23. License: CC BY 4.0.**
Read-only observation from the GitHub branch-protection API for
`geroiloyola/portaless`, branch `main`. Required reviews: 1; strict status checks
and administrator enforcement enabled. No settings were changed.

| Work | Workflow / job / emitted check | Required by observed main protection? |
|---|---|---|
| Standalone author/numbers/audit and external OpenSSL/JOSE/dnspython cross-check | Workflow **LTP specification assets (draft)**, job/check **cross-check** | **No.** It reports on PRs but is not in the required-check list. |
| Documentation boundary lint | `tests/unit/ltp-docs-boundary.test.ts` invokes standalone `tools/docs-boundary.mjs`; run by Unit Tests job `unit` / **vitest tests/unit (Node 24)**, Full Tests job `all-tests` / **Todos los tests + cobertura (Node 24)**, and CI job/check **build** | **Yes**, through those three required jobs; no separate required lint check exists. |
| Lint negative cases and contract tests in standalone package | `npm test` in job/check **cross-check** | **No** as a standalone job. The root lint invocation covers actual docs but not every standalone negative test. |

Observed required check contexts (exact names): `build`, `docker-smoke`, `upgrade`,
`Todos los tests + cobertura (Node 24)`, `vitest tests/unit (Node 24)`, `audit`.
This dated snapshot is not a promise that protection cannot change later.

## Proposal only — put standalone checks inside an already-required job

In a future reviewed CI change, add Python setup/pinned requirements and run
`npm run check:author`, `npm run check:numbers`, `npm run audit`, and `npm test`
from the spec package inside **Unit Tests / unit**, before root Vitest. That
would make external checks and standalone lint negatives fail the already-required
`vitest tests/unit (Node 24)` context without changing GitHub settings. Preserve
offline fixtures, pin dependencies and account for the added job time. The
standalone job could remain for isolated-repository evidence; decide in review.

**Not executed in this revision.** The current cross-check job remains nonrequired;
its green result must not be described as a branch-protection requirement.

## Apéndice: implementación de referencia

Workflow sources: [standalone job](../../.github/workflows/ltp-assets.yml),
[unit job](../../.github/workflows/unit-tests.yml),
[full tests](../../.github/workflows/full-tests.yml), [build](../../.github/workflows/ci.yml).
