# `@portaless/ltp-reputation`

G4 static-case evaluator. It consumes the immutable REP-01…REP-11 corpus
(`docs/protocol-apw/vectors/ltp/reputation/v0.1/`) and implements the projection,
eligibility, uniqueness, caps, HSVR and differential **decision cases**.

This package does not parse or verify JWS, signatures, issuer chains, DNS, or
raw attestations. Its decision cases receive explicit facts such as
`validSignature` or `chain`; those facts must come from a verifier. It is not
wired to the runtime and is not a production reputation authority. Empty,
unknown-field or malformed inputs fail closed instead of becoming `eligible`,
`accepted` or `complete`.

## Rules

- Unrounded binary64 score/priorShare/effectiveWeight, matching the static
  vectors. Zero-count/zero-weight dimensions are priors and do not enter the
  mean or denominator. Ordering/tolerance is a consumer rule (`1e-9`), not a
  mutation of the stored score.
- Ordering ties use locale-independent code-point order, so the result does not
  depend on the host ICU locale.
- Duplicate dimension names are invalid input. `REP-11-02` and `REP-11-05`
  expect an explicit `duplicate_dimension` rejection; the engine never
  aggregates, silently repairs or scores duplicate dimensions.
- Public level `trusted` is the G4 vector name. The legacy `apw-resolver`
  returns `reliable` for the same level; differential tests normalize that label.
- `2` unique evidence emitters is the maximum fan-out cap, not a minimum.
- `REP-09-12/13` remain `pending_owner_cap`; `REP-11-04` remains `pending-S4`;
  `REP-11-07` remains out of scope.
- G5 offline DNSSEC is not implemented.

## Verification

```bash
node node_modules/vitest/vitest.mjs run tests/unit/ltp-reputation-vectors.test.ts
```

The test loads all 117 JSON cases, runs the TypeScript engine and requires an
exact match with every `expected` object. It also runs all 13 `svri-math.json`
projections through both this package and `apw-resolver`, compares them within
`1e-9`, normalizes the legacy `reliable`/`trusted` label, and proves empty,
unknown-field, invalid-dimension, duplicate-dimension and zero-weight cases fail
closed or remain priors.

This package is not wired to the Portaless runtime/UI or activation; those
remain separate owner decisions.
