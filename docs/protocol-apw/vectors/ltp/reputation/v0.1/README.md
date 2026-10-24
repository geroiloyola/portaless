# LTP reputation static vectors v0.1 — REP-01…REP-11

**Status: audited static oracle targets. The G4 decision-case engine is
implemented in `packages/ltp-reputation/`; runtime activation, real emitters,
signed profiles and S4 independence remain outside this corpus.**
License: CC BY 4.0.

This directory is the machine-readable “Rosetta stone” for the 117 cases in
[LTP-S3-REPUTATION-MISSING-VECTORS.md](../../../../LTP-S3-REPUTATION-MISSING-VECTORS.md).
The values are precomputed by a fixture-only Python oracle using binary64
arithmetic. They are targets for the engine, not an engine result.

## What is here

| File | Family | Cases |
|---|---|---:|
| `rep-01-issuer.json` | REP-01 issuer identity/chain | 11 |
| `rep-02-attestation.json` | REP-02 signature/canonical bytes | 9 |
| `rep-03-uniqueness.json` | REP-03 `(iss,jti)` uniqueness/conflicts | 9 |
| `rep-04-eligibility.json` | REP-04 eligibility, age, `min_weight` | 14 |
| `rep-05-reader-conduct.json` | REP-05 reader-conduct categories | 12 |
| `rep-06-negatives.json` | REP-06 reader-conduct negatives | 10 |
| `rep-07-no-data.json` | REP-07 no-data/insufficient evidence | 10 |
| `rep-08-boundaries.json` | REP-08 arithmetic/level boundaries | 14 |
| `rep-09-caps.json` | REP-09 caps/fan-out/denominator | 13 |
| `rep-10-hsvr.json` | REP-10 HSVR/provenance | 8 |
| `rep-11-differential.json` | REP-11 differential/independent oracle | 7 |
| `coverage.json` | Exact 117-ID index | 117 |
| `manifest.json` | Static commitments and scope | — |

Every case has `id`, `kind`, `description`, `input` and `expected`. The expected
object is computed by the Python oracle for numeric cases; policy/predicate
cases carry the exact decision, reason, count, flag or cap result.

## Arithmetic and limits

- Adopted arithmetic: **binary64**, ordering rounded to 6 decimals, comparison
  tolerance **`1e-9`**, levels classified from unrounded values.
- Rational values are **oracle metadata**, not the normative wire arithmetic.
- “2 emitters” is the **maximum fan-out cap**, not a minimum; the minimum is the
  `min_weight` threshold (2.0) plus distinct-emitter/age rules.
- REP-09-12/13 intentionally remain `pending_owner_cap`: a denominator bit cap
  is a future owner decision, not invented by this static corpus.
- REP-11-04 remains `pending-S4`; same-author agreement is not independence.
- REP-11-07 is out of scope: a signed rational profile needs its own schema and
  vectors.
- Duplicate dimension names are invalid. REP-11-02 and REP-11-05 expect an
  explicit `duplicate_dimension` rejection; duplicates are never aggregated,
  repaired or scored.

## Generate and check

```bash
python3 docs/protocol-apw/tools/reputation-author.py --publish
python3 docs/protocol-apw/tools/reputation-author.py --check
```

Expected summary:

```json
{
  "candidateDigest": "eDKwJyZNX9tzLjfpZHiV5T85qylOCcenOySK_GSmT6k",
  "families": 11,
  "cases": 117,
  "engineImplemented": true,
  "arithmetic": "binary64+tolerance"
}
```

`--check` re-runs the oracle and compares every parsed JSON object. The Python
tool is fixture-only: it imports only the standard library, is never imported by
Portaless, and is not a verifier or engine.

## Audit record

The G4 audit confirmed:

1. All 117 IDs match the matrix and `coverage.json` exactly.
2. Numeric expectations are reproduced by the Python oracle within `1e-9`, with
   exact counts/flags/levels.
3. Boundary cases at 5/7/9 and the cross-axis cases are correct.
4. `REP-09-12/13` remain pending an explicit denominator cap.
5. `REP-11-04` remains pending an independent S4 oracle.
6. Duplicate dimensions are rejection cases, not projection inputs.

The TypeScript decision-case engine is in `packages/ltp-reputation/`. No runtime
engine, raw-evidence verifier or production integration is introduced by this
directory. G4 remains a static-scope approval; G5 remains frozen.
