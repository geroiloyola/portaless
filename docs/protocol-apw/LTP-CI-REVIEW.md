# Draft asset checks inside the required unit job

**Status: review note, 2026-10-23. License: CC BY 4.0.**
Read-only observation from the GitHub branch-protection API for
`geroiloyola/portaless`, branch `main`. Required reviews: 1; strict status checks
and administrator enforcement enabled. No settings were changed.

| Work | Workflow / job / emitted check | Required by observed main protection? |
|---|---|---|
| Original and core author/numbers/audits, external OpenSSL/JOSE/dnspython checks and standalone contract tests | **Unit Tests / unit**, emitted context **vitest tests/unit (Node 24)**, step **LTP static cross-check (required unit job)** | **Yes**, through the existing required unit context. Commands fail the job; no continue-on-error. |
| Documentation boundary lint | `tests/unit/ltp-docs-boundary.test.ts` invokes standalone `tools/docs-boundary.mjs`; run by Unit Tests job `unit` / **vitest tests/unit (Node 24)**, Full Tests job `all-tests` / **Todos los tests + cobertura (Node 24)**, and CI job/check **build** | **Yes**, through those three required jobs; no separate required lint check exists. |
| Lint negative cases, frozen corpus and contract tests in standalone package | `npm test` in **Unit Tests / unit** | **Yes**, in that same required context. |

Observed required check contexts (exact names): `build`, `docker-smoke`, `upgrade`,
`Todos los tests + cobertura (Node 24)`, `vitest tests/unit (Node 24)`, `audit`.
This dated snapshot is not a promise that protection cannot change later.

## Owner-authorized consolidation — executed in this static cycle

The execution instruction selected the already-required job rather than changing
GitHub protection. Unit now installs pinned Python fixture dependencies and runs
`check:author`, `check:numbers`, `audit`, `check:core`, `audit:core`, `check:ab`,
`audit:ab` and `npm test`
from the spec package before root Vitest. The separate `cross-check` workflow was
removed; no separate GitHub check is required or introduced. The six protected
context names remain unchanged, as do strict production coverage thresholds.

This consolidates fixture checks only. It does not run an LTP engine, make a
network request from a transcript, implement budgets, approve S3-core or start A/B.
The sole authorization definitions/states are in
[LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).

## Apéndice: implementación de referencia

Workflow sources: [unit job](../../.github/workflows/unit-tests.yml),
[full tests](../../.github/workflows/full-tests.yml), [build](../../.github/workflows/ci.yml).
