# G4 pre-authorization review — reputation/SVRI arithmetic

**Status: review only. G4 is not authorized. No code, profile, vector or
activation is introduced by this document. License: CC BY 4.0.**
G4 remains `PENDING_AUTHORIZATION` in the
[canonical register](./LTP-GATES-AND-AUTHORIZATIONS.md). This report exists so a
future owner decision starts from the real implementations, the normative
arithmetic and the tests that would be required.

## 1. What exists today

| Component | Evidence | What it actually implements |
|---|---|---|
| `packages/apw-resolver/src/scoring/scoring.ts` | `issuerWeight` `:37-40`, `bayesianScore` `:75-88`, `calibrateJudges` `:110+` | Emitter weight `w(J)=((clamp(J,1,7)-1)/6)^2`, prior-weighted Bayesian score, leave-one-out J calibration. |
| `packages/apw-resolver/src/scoring/site-dimensions.ts` | imports `:36-37`; `bayesianScore` use `:293`; calibration/gating `:308,326` | Site W dimensions, E-13 gating and derived W-09 coherence. |
| `packages/apw-resolver/src/scoring/svri.ts` | `SVRI_VERSION` `:23-24`, `projectSvri` `:135`, `toPublicSvriProjection` `:483-485` | SVRI v1.0 projection and the public qualitative-only view. |
| `packages/apw-resolver/src/scoring/svri-history.ts` | imports `buildSiteSvriDetail` `:3`; reconstruction `:127,162` | HSVR reconstruction from append-only evidence. |
| `functions/trust/[siteId].js` | imports `:34-40`; calls `buildSiteSvriDetail` `:203` | Runtime reader that computes the site projection through `apw-resolver`. |
| `functions/admin/api/svri.js` | imports `:9`; uses `reconstructSvriHistory` | Admin-only HSVR surface. |
| `packages/trust-layer/src/site-trust/site-trust-score.ts` | score type `:95` | A separate legacy 1–5 SiteTrustScore, **not** SVRI v1.0. |

Correction to the working assumption: `packages/trust-layer` does not contain a
second SVRI implementation. The SVRI projection lives in `apw-resolver`; the
runtime route `functions/trust/[siteId].js` imports it. `ltp-engine` currently
implements **no** reputation math. Adding a fourth copy there would worsen the
divergence risk; a future G4 should reuse or explicitly differential-test the
existing primitives.

Existing tests are same-author oracles: `scoring.test.ts:28-35` compares with
`toBeCloseTo`, and `packages/apw-resolver/src/scoring/svri.test.ts` checks the
projection. Those are useful regressions, but they are not independent review.

## 2. Normative arithmetic

The published rule is **binary64 (IEEE-754) with an absolute tolerance**, not
exact rational arithmetic:

- `APW-SPEC-v1.3.md:502`: "Scores are rounded to 6 decimals and compared with
  tolerance `1e-9` (the same rule as A.4.5 and V-08: `((6.7-1)/6)^2` is not exact
  in IEEE-754)."
- `LTP-SERIALIZATION-DRAFT-v0.1.md:196-202`: transmit finite JSON numbers;
  exact rational numerators/denominators are **test-oracle metadata**, not new
  protocol fields; compare recomputed numerical fields within `1e-9`; counts,
  booleans, digests and versions exactly; classify from **unrounded** values.
- `SVRI-v1.0.md:97`: the level is classified from the unrounded number.
- `vectors/ltp/v0.1/svri-math.json` carries both a binary64 `score` and a
  `rational` object. The rational is oracle metadata for the same result, not a
  wire representation.

A future signed SVRI/HSVR profile is different: `LTP-SERIALIZATION-DRAFT-v0.1.md:166-172`
requires rational or string encoding and a new versioned schema/vectors. That
future signed profile is not the adopted unsigned projection and is not
authorized by G4.

> **Mandatory citation for any future G4 authorization.** The adopted SVRI
> arithmetic is **binary64**, rounded to 6 decimals for ordering and compared
> with absolute tolerance `1e-9`; levels are classified from unrounded values.
> The `rational` values in `svri-math.json` are **test-oracle metadata**, not the
> normative wire arithmetic. Exact fractions are only a future signed-profile
> option requiring a new versioned schema and vectors. Any G4 authorization must
> cite this section and the sources above; it must not describe rational
> arithmetic as the current normative rule.

Consequence: an engine that computes exact fractions and exposes exact decimals
must still match the published binary64 values within `1e-9` and must not change
a pending/low/verify/safe/trusted boundary. Exact fraction numerators and
denominators may differ from the reference; byte-identical JCS output is not a
valid acceptance criterion for the current unsigned projection.

## 3. Denominator and work bounds (proposal, not a decision)

If a future signed/rational profile is chosen, the denominator of
`(3 + Σw_i)` is the lcm of emitter-weight denominators and can grow with the
number of emitters. The approved D7 baseline already caps the inputs:

- **2 unique evidence emitters per resolution is a maximum fan-out cap, not a
  minimum** (`resolution-chain-proposal.md:382`). The policy minimum is the
  `min_weight` threshold (default 2.0) per `(subject, category)`, plus the
  distinct-emitter and minimum-history-age rules (`APW-SPEC-v1.3.md:456-460`);
  a single emitter may be recorded but can remain below the threshold or weigh 0.
- 200 reader-conduct candidates per resolution (`:381`).
- 400 history entries, 16 history keys (`:378-379`).
- 640 signature attempts, 24 HTTP attempts, 4 MiB, 10 s (`:383-386`).

A G4 proposal should add an explicit denominator/numerator bit cap, reject or
normalize outside it, and test the worst case at the emitter/candidate caps.
Those numbers, and whether exact fractions are adopted for a signed profile,
require an owner decision; this document sets none.

## 4. Differential tests required before G4

1. Run every `svri-math.json` case through `apw-resolver` and the candidate
   implementation. Compare `score`, `priorShare` and `effectiveWeight` within
   `1e-9`; compare counts, flags and `publicLevel` exactly.
2. Repeat at the 5/7/9 boundaries with unrounded values; tolerance must not flip
   a level or repair `incompleteData`/`isInference`.
3. Run the same signed/attestation snapshot through both implementations and
   compare each W dimension and the SVRI projection. Do not re-implement
   calibration to "match" the oracle.
4. Property/adversarial cases at the caps: the **maximum** 2 distinct emitters,
   200 candidates, 16 keys, 400 history entries, duplicate `(iss,jti)`,
   expired/out-of-window keys, self-attestations, `min_weight` exactly at and
   below 2.0, the 7-day emitter-age boundary, and denominator growth.
5. An independent verifier/person/language/backend (S4) must reproduce the
   published vectors. Same-author agreement is necessary but not sufficient.
6. Store the implementation revision, arithmetic mode and caps with the
   evidence. If a future signed profile uses rationals, compare its canonical
   bytes exactly; if it uses binary64, compare values within tolerance and never
   claim byte identity.

The family-level requirements above are enumerated case by case in
[LTP-S3-REPUTATION-MISSING-VECTORS.md](./LTP-S3-REPUTATION-MISSING-VECTORS.md):
REP-01…REP-11, with a boundary condition and expected invariant per case. That
matrix, not this summary, is the documentary evidence for vector completeness.

## 5. Open decisions before any G4 code

- Any future G4 authorization must cite §2: the adopted unsigned SVRI is
  binary64 with `1e-9` tolerance; rationals are oracle metadata; exact fractions
  are only a future signed-profile option with new vectors.
- Decide whether G4 reuses `apw-resolver` primitives or introduces a separately
  reviewed implementation with differential tests.
- Set emitter/denominator/work caps and the adversarial test matrix.
- Identify an independent oracle or reviewer; the current vectors are authored
  by the same maintainer.
- Define the real-emitter evidence required for any production reputation claim;
  vectors alone cannot satisfy it.

Until those decisions are recorded, G4 remains pending and no reputation/SVRI
math is implemented in `ltp-engine`.
