# S3-reputation — vectors missing before G4 TDD

**Status: inventory only. G4 is `PENDING_AUTHORIZATION`; no reputation code,
profile or vector is added here.** This list answers what must exist before a
future G4 implementation can start test-first, and separates deterministic
vectors from the real-emitter evidence that vectors cannot replace.

Current gap source: [S3 coverage §S3-reputation](./LTP-S3-COVERAGE.md)
(lines 56-62), [G4 gate](./LTP-GATES-AND-AUTHORIZATIONS.md) (line 17), and the
[G4 pre-review](./LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md).

## 1. What already exists (not enough for G4)

| Existing | Where | Covers |
|---|---|---|
| Scoring primitives | `APW-VECTORS-v1.3.md:216` (V-08) | `w(J)`, value mapping, category→dimension mapping. |
| Bayesian examples | `APW-VECTORS-v1.3.md:244` (V-09) | Prior-weighted score examples A/B. |
| R-05 calibration | `APW-VECTORS-v1.3.md:259` (V-10) | Two leave-one-out scenarios. |
| `reader_conduct` | `APW-VECTORS-v1.3.md:309` (V-12) | Emission, deterministic `jti`, completeness table. |
| SVRI projection | `vectors/svri/v1.0/svri-projection.json` (7 cases) | Projection arithmetic, flags and public levels. |

These are necessary but not sufficient: they do not freeze full issuer
eligibility, `(iss,jti)` conflicts, community admissibility at the caps, negative
evidence behavior, or an independent oracle.

## 2. Missing vector families

Proposed IDs are labels for review; they are not normative until published.

| ID | Missing family | Minimum cases before TDD | Why it blocks G4 |
|---|---|---|---|
| REP-01 | Issuer identity and chain | Valid issuer DID/key/chain; wrong DID; missing history; key outside window; revoked/rotated key; unregistered issuer; self-issuer; incomplete chain. | `reader_conduct`/`community` cannot be scored without a verified issuer root. |
| REP-02 | Attestation signature and canonical bytes | Valid Ed25519; one-bit mutation; wrong `kid`; non-JCS payload; wrong `typ`; expired `iat`; duplicate `jti`. | A score over unverified attestations is not evidence. |
| REP-03 | `(iss,jti)` conflicts | Same `(iss,jti)` identical retransmission; same id with a different payload; duplicate across stores; deterministic selection/counting; no double count. | Current coverage names this gap explicitly. |
| REP-04 | Community eligibility | Distinct `did:apw` emitters; one operator with several domains; emitter history younger than 7 days; `min_weight` exactly 2.0, below and above; self-attestation excluded; weight-0 emitters recorded but not counted. | E-13 rules decide whether a community score exists at all (`APW-SPEC-v1.3.md:456-460`). |
| REP-05 | Reader-conduct categories | `respected_policy`→R-01, `policy_violation`→R-01 inverse, `rate_respected`→R-02, `paid_as_agreed`→R-03, `redistribution`→R-04 inverse; unknown category → error; `val` false/true. | Category mapping exists in V-12, but full positive/negative cases and R profiles do not. |
| REP-06 | Reader-conduct negatives | Wrong issuer, issuer ≠ reader’s TXT `k`, issuer = reader, missing JWS after cutoff, legacy before cutoff, JWS hash not in chain, unsigned/legacy row. | A reader must not hide negatives or count its own attestation. |
| REP-07 | No-data and insufficient evidence | No attestations; only T3/T5; below `min_weight`; `priorShare` exactly 0.5; `incompleteData`; a dimension absent from the mean; neutral prior mapped to 5.0 but not presented as measurement. | G4 must return “no data/pending”, not a fabricated score. |
| REP-08 | Boundaries and arithmetic | Scores at 5/7/9 from unrounded values; 6-decimal ordering; `1e-9` tolerance; values just below/above each boundary; `score10` mapping; exact-rational oracle metadata vs binary64 wire. | The normative arithmetic is binary64+tolerance; exact fractions must not be described as wire. |
| REP-09 | Work and fan-out caps | Maximum 2 unique evidence emitters per resolution, 200 candidates, 16 keys, 400 history entries; over-cap behavior fails closed/partial; adversarial emitter/denominator growth if a signed rational profile is ever chosen. | “2” is a maximum fan-out cap, not a minimum; the minimum is `min_weight` 2.0. |
| REP-10 | HSVR/reconstruction | Complete reconstruction; partial due to missing key/attestation/anchor; rules/snapshot version mismatch; history without source data; no filling with current score. | Reputation output must retain verifiable provenance, not a bare number. |
| REP-11 | Differential/independent oracle | Same inputs through `apw-resolver` and a candidate implementation; compare score/flags/level; independent person/language/backend (S4); published-vector reproduction. | Same-author agreement is not sufficient; S4 remains open. |

## 3. Evidence that is not a vector

These are required for a production reputation claim but cannot be satisfied by
fixtures:

- Real, distinct emitters/operators that actually issue eligible `community`
  and `reader_conduct` attestations. R-05 currently has no real emitter corpus
  (`APW-SPEC-v1.3.md:486`).
- Operational history older than the 7-day emitter-age threshold.
- A controlled, consented index/witness source if cross-emitter calibration is
  claimed.
- An independent verifier (S4) and a normative signed profile (S6) if the
  output is to be published as more than the current unsigned SVRI projection.

## 4. Definition of ready for G4 TDD

G4 should not start until the owner records:

1. The normative arithmetic statement: binary64, 6-decimal ordering,
   `1e-9` tolerance, unrounded level classification; rationals are oracle
   metadata (`LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md:33-58`).
2. Emitter/denominator/work caps and the adversarial matrix (REP-09), explicitly
   stating that 2 emitters is a maximum, not a minimum.
3. The REP-01…REP-11 vectors, reviewed and versioned; the expected values must
   not be generated by the implementation under test.
4. A differential oracle and an independent S4 plan.
5. The real-emitter evidence plan; until then, the only honest result is
   `no_data`/pending, not a production reputation claim.
6. G4 authorization itself, recorded in the canonical register.

Until all six exist, G4 remains pending and no reputation/SVRI math is written in
`ltp-engine`.
