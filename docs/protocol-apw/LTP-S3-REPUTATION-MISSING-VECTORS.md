# S3-reputation — enumerated vector matrix (REP-01…REP-11)

**Status: static vector specification only. G4 is `PENDING_AUTHORIZATION`; no
reputation/SVRI execution code, profile or activation is introduced here.**
This file replaces the earlier family-level list with an enumerated matrix: every
case has an ID, a boundary condition and an expected invariant. It is the
documentary evidence the G4 authorization must cite before any TDD starts.

Sources: [S3 coverage §S3-reputation](./LTP-S3-COVERAGE.md),
[G4 gate](./LTP-GATES-AND-AUTHORIZATIONS.md),
[G4 pre-review](./LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md),
`APW-SPEC-v1.3.md:456-460,486,502`,
`LTP-SERIALIZATION-DRAFT-v0.1.md:196-202`,
`SVRI-v1.0.md:97-105`, and the existing vectors V-08/V-09/V-10/V-12 plus
`vectors/svri/v1.0/svri-projection.json`.

## 1. Exhaustiveness argument

Every reputation input belongs to exactly one of ten axes. The matrix covers
each axis in six modes: valid, exact boundary, one step below, one step above,
invalid/conflict, and permutation/duplication. Cross-axis interactions that can
change a decision are enumerated explicitly (REP-04-13, REP-08-12/13,
REP-09-09, REP-10-08).

| Axis | What it decides | Families |
|---|---|---|
| A. Source/tier | Whether T1–T5 counts and W/R dimensions participate | REP-04, REP-05, REP-07 |
| B. Issuer root | Whether an emitter is authenticated at the attestation time | REP-01 |
| C. Attestation bytes | Whether the artifact is valid and canonical | REP-02 |
| D. Uniqueness | Whether a statement is counted once or rejected as a conflict | REP-03, REP-06 |
| E. Eligibility/weight/age | Whether an emitter counts toward `min_weight` | REP-04 |
| F. Category/value | Which dimension and value a category produces | REP-05, REP-06 |
| G. Missing/insufficient evidence | Whether the result is absent, pending or neutral | REP-07 |
| H. Arithmetic/level | Which public level and ordering a number produces | REP-08 |
| I. Work/fan-out/denominator | Whether the calculation is admitted or fails closed | REP-09 |
| J. Provenance/equivalence | Whether the result is reconstructible and independently reproduced | REP-10, REP-11 |

Out of scope for this matrix: G5 offline DNSSEC, a future signed rational SVRI
profile (needs its own schema and vectors), and real-emitter evidence (listed in
§4; it is not a vector case).

**Coverage count:** REP-01 11 cases, REP-02 9, REP-03 9, REP-04 14, REP-05 12,
REP-06 10, REP-07 10, REP-08 14, REP-09 13, REP-10 8, REP-11 7 — **117
enumerated cases**. Each family includes the applicable valid, exact-boundary,
one-below, one-above, invalid/conflict and permutation/duplication modes; the
cross-family interactions are explicitly listed.

## 2. Enumerated matrix

### REP-01 — Issuer identity and chain

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-01-01 | Valid issuer DID, key inside its window, chain reaches the attested seq | Issuer verified; attestation eligible for its category; no extra weight from tier alone |
| REP-01-02 | Issuer DID/key belongs to another subject | Reject; zero weight; no count; deterministic reason |
| REP-01-03 | Issuer identity/history missing | Not eligible; subject gets no evidence from that emitter; `no_data`, never a neutral score |
| REP-01-04 | Key `ts` exactly at `validFrom` | Accepted (inclusive boundary); window rule is deterministic |
| REP-01-05 | Key `ts` exactly at `validTo` | Accepted; endpoints are included in the APW window (`APW-SPEC-v1.3.md:251`) |
| REP-01-06 | Key one second before `validFrom` / after `validTo` | Reject; zero weight |
| REP-01-07 | Retired key at `validTo`, inside the 10-minute rollover grace | Accepted inside `[validFrom, validTo + grace]`; after the grace, rejected; current key never retroactively signs |
| REP-01-08 | Self-issuer (`iss == sub`) or issuer is the reader itself | Excluded from the subject’s reputation/R-05; self cannot launder its own score |
| REP-01-09 | Incomplete chain or JWS hash not anchored in the issuer chain | Reject; no score contribution; no invented anchor |
| REP-01-10 | Same DID under several domains | Collapses to one emitter; aliases do not multiply weight |
| REP-01-11 | Two distinct `did:apw` controlled by one operator | Count as distinct emitters per E-13; operator collusion is a separate evidence risk |

Anchor: `APW-SPEC-v1.3.md:456-460`; V-05/V-06 history and foreign-issuer rules.

### REP-02 — Attestation signature and canonical bytes

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-02-01 | Valid Ed25519 over the exact compact JWS | Accepted; hash/digest is over original bytes, never reserialized |
| REP-02-02 | One-bit signature mutation | Reject `bad_signature`; zero contribution |
| REP-02-03 | Wrong `kid` or key not in the issuer key set | Reject; no fallback key |
| REP-02-04 | Payload not equal to `JCS(JSON.parse(payload))` | Reject `not_canonical`; no permissive parse |
| REP-02-05 | Wrong `typ` / unsupported algorithm | Reject; no algorithm negotiation from the artifact |
| REP-02-06 | `iat` outside the key window / expired attestation | Reject; zero weight; no “current key” refresh |
| REP-02-07 | Identical JWS retransmitted | Count once; deterministic de-duplication |
| REP-02-08 | Private key member or malformed JWK | Reject; public members only |
| REP-02-09 | Valid signature but wrong subject (`sub`) | Reject for that subject; no cross-subject attribution |

Anchor: `APW-SPEC-v1.3.md` V-06/V-07; `LTP-SERIALIZATION-DRAFT-v0.1.md:196-202`.

### REP-03 — `(iss,jti)` uniqueness and conflicts

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-03-01 | Same `(iss,jti)`, identical payload, repeated | One count; second copy is a retransmission |
| REP-03-02 | Same `(iss,jti)`, different payload | Explicit conflict; deterministic rejection/exclusion; never double count; order must not change the result |
| REP-03-03 | Same `(iss,jti)` across two stores/backends | One logical attestation; no double count after merge |
| REP-03-04 | Same `jti`, different `iss` | Distinct keys; both may count if otherwise valid |
| REP-03-05 | Missing `iss` or `jti` | Ineligible; no count; no random identifier invention |
| REP-03-06 | Permutation of a valid set | Same score, counts and flags; order-independent |
| REP-03-07 | Duplicate `(iss,jti)` one valid/one mutated | Conflict/rejection; cannot use the valid copy to hide the mutation |
| REP-03-08 | Legacy row without JWS after cutoff | Reject as incomplete (`apw_unresolvable`) |
| REP-03-09 | Legacy row before cutoff, policy ignore/reject | Ignore only under the explicit policy; never count as verified evidence |

Anchor: S3 coverage `:61`; V-12 completeness table.

### REP-04 — Community eligibility, age and `min_weight`

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-04-01 | Emitter history age exactly 7 days | Eligible; counts toward `min_weight` if weight > 0 |
| REP-04-02 | Emitter age 7 days minus one second | Recorded but weight 0; does not count toward `min_weight` |
| REP-04-03 | Emitter age one second over 7 days | Eligible; same rule as REP-04-01 |
| REP-04-04 | `min_weight` exactly 2.0 with eligible distinct emitters | Predicate passes (`>=` boundary); subject may score |
| REP-04-05 | `min_weight` 1.999999999 or one unit below | Predicate fails; subject absent; no neutral prior substitution |
| REP-04-06 | One eligible emitter | May be recorded; if weight sum < 2.0 the category does not score |
| REP-04-07 | Exactly two distinct eligible emitters | Accepted as input (within the fan-out cap); scoring still depends on `min_weight`; **2 is the maximum, not a minimum** |
| REP-04-08 | Three distinct emitters | Over the maximum fan-out cap; deterministic truncation/rejection; no score/grant from the excess |
| REP-04-09 | Same DID via several domains/aliases | One emitter; no multiplicity |
| REP-04-10 | Two domains owned by one operator, distinct DIDs | Distinct emitters per E-13; collusion remains an evidence risk |
| REP-04-11 | Self-attestation / attestation about own subject | Excluded from R-05 and its own subject evidence |
| REP-04-12 | Weight-0 emitter recorded | Visible as raw data but does not count; no denominator contribution |
| REP-04-13 | Age 7d−1s × `min_weight` exactly 2.0 | Still fails: zero-weight emitter cannot satisfy the threshold (cross-axis) |
| REP-04-14 | Only T3/T5 evidence, no T1/T2 | `incompleteData=true`; no complete-site claim |

Anchor: `APW-SPEC-v1.3.md:456-460` (E-13); D7 fan-out `resolution-chain-proposal.md:382`.

### REP-05 — Reader-conduct categories and values

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-05-01 | `respected_policy` with `val:true` | R-01 value 7.0 |
| REP-05-02 | `respected_policy` with `val:false` | R-01 value 1.0 |
| REP-05-03 | `policy_violation` with `val:true` | R-01 value 1.0 (inverse) |
| REP-05-04 | `policy_violation` with `val:false` | R-01 value 7.0 (inverse) |
| REP-05-05 | `rate_respected` true/false | R-02 7.0/1.0 |
| REP-05-06 | `paid_as_agreed` true/false | R-03 7.0/1.0 |
| REP-05-07 | `redistribution` true | R-04 1.0 (inverse); false follows the inverse mapping |
| REP-05-08 | Unknown category | Error; no dimension, no silent drop |
| REP-05-09 | Non-boolean `val` for a boolean category | Error; no coercion |
| REP-05-10 | `community` value 1, 2.5, 4, 5.5, 7 | Exact linear mapping; 0/6/NaN rejected |
| REP-05-11 | T4 reader-conduct activity on a site | `t4Count` activity only; never adds W evidence or score weight |
| REP-05-12 | Reader-conduct for a different subject | Excluded from that subject’s R; no cross-subject count |

Anchor: V-08/V-12; `SVRI-v1.0.md:1-30`.

### REP-06 — Reader-conduct negatives and completeness

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-06-01 | Wrong issuer key/signature | `apw_unresolvable`; excluded; no positive fallback |
| REP-06-02 | Issuer is not the reader’s TXT `k` | Reject; no self-authored reputation |
| REP-06-03 | Issuer equals the reader | Excluded from the reader’s own R dimension |
| REP-06-04 | Missing JWS after `legacyCutoff` | Completeness broken; `apw_unresolvable` |
| REP-06-05 | Missing JWS before cutoff, policy `ignore` | Explicitly ignored; never counted |
| REP-06-06 | Missing JWS before cutoff, policy `reject` | `apw_unresolvable`; no partial score |
| REP-06-07 | JWS hash not present in the chain | Dropped; cannot be invented or counted |
| REP-06-08 | Unsigned legacy row | Ignored/rejected per policy; never a positive attestation |
| REP-06-09 | Origin omission / equivocation | Not detectable from one chain; result must not claim completeness |
| REP-06-10 | T4 activity vs W evidence | T4 remains activity; no W score credit |

Anchor: V-12 completeness table; `APW-SPEC-v1.3.md:486`.

### REP-07 — No-data and insufficient evidence

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-07-01 | No attestations | Score 5.0 neutral, `priorShare=1`, `effectiveWeight=0`, `incompleteData=true`, `isInference=true`, level `pending`; not a measurement |
| REP-07-02 | Only T3/T5 sources | `incompleteData=true`; level `pending`; no complete-site claim |
| REP-07-03 | Below `min_weight` | Subject absent from `top`; never filled with the neutral prior |
| REP-07-04 | `priorShare` exactly 0.5 | `isInference=false` (`>0.5` rule); boundary frozen |
| REP-07-05 | `priorShare` just above/below 0.5 | Inference flag flips only across the boundary; no rounding-based flip |
| REP-07-06 | Zero effective dimensions | Score 5, weight/count 0, `priorShare=1`; no dimension entry |
| REP-07-07 | One dimension with no data | Omitted from the mean; not replaced by 4.0 |
| REP-07-08 | T4 activity only | Activity counts visible; W score absent |
| REP-07-09 | Incomplete data but high raw score | Public level `pending`, not `safe`/`trusted` |
| REP-07-10 | Unknown/malformed source | Excluded with an explicit reason; no silent neutralization |

Anchor: `SVRI-v1.0.md:97-105`; SVRI vectors `prior-only`, `t4-not-w-evidence`.

### REP-08 — Arithmetic and level boundaries

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-08-01 | Score exactly 5.0 | Level `verify` (`>=5`), not `low` |
| REP-08-02 | Score 4.999999999 (just below 5) | Level `low`; classify unrounded |
| REP-08-03 | Score exactly 7.0 with `isInference=false` | Level `safe` (`>=7`) |
| REP-08-04 | Score 6.999999999 | Level `verify` |
| REP-08-05 | Score exactly 9.0, complete, non-inference, T1/T2 present | Level `trusted` |
| REP-08-06 | Score 8.999999999 | Level `safe` |
| REP-08-07 | Two scores equal after 6-decimal rounding | Ordering tie-break by `Σweight`, count, subject; not by rounded equality alone |
| REP-08-08 | Two values within `1e-9` | Numerically equal for ordering; counts/flags/digests still exact |
| REP-08-09 | `((6.7−1)/6)^2` in binary64 vs `0.9025` oracle | Accept within `1e-9`; do not require exact decimal bytes |
| REP-08-10 | Score10 endpoints 1→0 and 7→10 | Linear mapping; mean over included dimensions only |
| REP-08-11 | Exact rational oracle metadata | Convert/compare to binary64 within `1e-9`; rationals are not wire |
| REP-08-12 | Score 7.0 × `isInference=true` | `verify`, not `safe` (cross-axis) |
| REP-08-13 | Score 9.0 × `incompleteData=true` | `pending`, not `trusted` (cross-axis) |
| REP-08-14 | Boundary exactly at 5/7/9 with prior/inference flags | Flags and unrounded value decide; tolerance must not repair a flag |

Anchor: `APW-SPEC-v1.3.md:502`; `LTP-SERIALIZATION-DRAFT-v0.1.md:196-202`;
`SVRI-v1.0.md:97`.

### REP-09 — Caps, fan-out and denominator

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-09-01 | Exactly 2 unique evidence emitters | Within the maximum fan-out cap; accepted as input; not a guarantee of a score |
| REP-09-02 | 3 unique evidence emitters | Over-cap; deterministic fail-closed/partial result; excess never scores |
| REP-09-03 | 200 reader-conduct candidates | Accepted at the cap |
| REP-09-04 | 201 candidates | Over-cap; explicit partial/rejection; no silent truncation that hides negatives |
| REP-09-05 | 16 history keys | Accepted |
| REP-09-06 | 17 history keys | Reject/partial; no arbitrary key import |
| REP-09-07 | 400 history entries | Accepted |
| REP-09-08 | 401 entries | Reject/partial; no truncated prefix presented as complete |
| REP-09-09 | 640 signature attempts | Accepted at the cap |
| REP-09-10 | 641 attempts | `budget_exhausted`; no refund on failure |
| REP-09-11 | 2 emitters exactly at `min_weight=2.0` | Passes; cap and threshold are independent |
| REP-09-12 | Rational denominator at max emitters (future signed profile) | Bounded by an explicit bit cap; over-cap rejected/normalized deterministically |
| REP-09-13 | Adversarial emitter/denominator growth | Bounded time/memory; no unbounded denominator; explicit overflow policy |

Anchor: D7 `resolution-chain-proposal.md:378-386`; G4 review `:76` (2 is maximum).

### REP-10 — HSVR and provenance

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-10-01 | Complete historical reconstruction | Same score, counts, flags and level as the original snapshot |
| REP-10-02 | Missing historical key | Partial; never fill with current score |
| REP-10-03 | Missing attestation/JWS | Partial; gap visible; no invented entry |
| REP-10-04 | Missing DNS/anchor | Partial; no complete claim |
| REP-10-05 | Rules/snapshot version mismatch | Partial/unsupported; no silent upgrade |
| REP-10-06 | Reordered history events | Deterministic sequence/order; no score drift |
| REP-10-07 | Current score requested for a missing past event | Refuse; current cannot substitute past |
| REP-10-08 | Partial history × high current score | `pending`/partial, not `trusted` (cross-axis) |

Anchor: `SVRI-v1.0.md` HSVR section; `APW-SPEC-v1.3.md:359`.

### REP-11 — Differential and independent reproduction

| Case ID | Boundary condition | Expected invariant |
|---|---|---|
| REP-11-01 | Every `svri-math.json` case through `apw-resolver` and candidate | Score/priorShare/weight within `1e-9`; counts/flags/level exact |
| REP-11-02 | Same signed snapshot through `scoreSiteDimensions` and candidate | Per-dimension agreement; no re-implementation drift |
| REP-11-03 | Same input, different order/permutation | Identical result |
| REP-11-04 | Independent person/language/backend (S4) reproduces published vectors | Independent acceptance; same-author agreement is insufficient |
| REP-11-05 | Random/adversarial inputs at caps | No divergence beyond tolerance; no boundary flip |
| REP-11-06 | Implementation revision/arithmetic mode/caps recorded | Reproducible evidence; binary64 vs rational declared |
| REP-11-07 | Signed-rational profile request | Out of scope until a new versioned schema/vectors exist; do not compare bytes to binary64 |

Anchor: `APW-SPEC-v1.3.md:502`; `LTP-SERIALIZATION-DRAFT-v0.1.md:196-202`;
`SVRI-v1.0.md:124`.

## 3. Existing vectors vs. required coverage

| Existing | Covers | Still missing |
|---|---|---|
| V-08 | `w(J)`, value/category mapping | Full category positives/negatives, error cases |
| V-09 | Bayesian examples | No-data, inference/completeness, caps |
| V-10 | Two calibration scenarios | Age, `min_weight`, distinct-emitter, fan-out |
| V-12 | Emission, `jti`, completeness table | Full `(iss,jti)` conflict matrix, legacy/negative matrix |
| `svri-projection.json` (7) | Projection arithmetic/flags | Full boundary matrix at 5/7/9, differential oracle |

Existing vectors are necessary but NOT sufficient. REP-01…REP-11 are the missing
coverage; they must be versioned and reviewed before G4 TDD.

## 4. Evidence that is not a vector

- Real, distinct emitters/operators issuing eligible `community` and
  `reader_conduct` attestations; R-05 has no real emitter corpus today
  (`APW-SPEC-v1.3.md:486`).
- Operational history older than 7 days.
- A consented index/witness source if cross-emitter calibration is claimed.
- Independent S4 verifier and, for a signed output, the S6 normative release.

## 5. Definition of ready for G4 TDD

1. The binary64/`1e-9` statement and the “2 is a maximum” rule are cited.
2. REP-01…REP-11 cases are published, versioned and reviewed.
3. Expected values are authored independently, not generated by the implementation.
4. Caps and denominator policy are frozen; adversarial REP-09 cases pass.
5. A differential oracle and S4 plan exist.
6. Real-emitter evidence plan exists; otherwise the only honest output is `no_data`.
7. G4 itself is explicitly authorized in the canonical register.

Until all seven exist, G4 remains `PENDING_AUTHORIZATION` and no reputation/SVRI
math is written.
