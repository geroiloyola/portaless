# `@portaless/ltp-reputation`

G4 SVRI reputation engine. It consumes the immutable REP-01…REP-11 static corpus
(`docs/protocol-apw/vectors/ltp/reputation/v0.1/`) and computes the projection,
eligibility, uniqueness, caps, HSVR and differential targets.

## Rules

- Unrounded binary64 score/priorShare/effectiveWeight, matching the static
  vectors. Ordering/tolerance is a consumer rule (`1e-9`), not a mutation of the
  stored score.
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
exact match with every `expected` object. It also compares projection cases with
the existing `apw-resolver` implementation within `1e-9`, normalizing the legacy
`reliable`/`trusted` label.

This package is not wired to the Portaless runtime/UI or activation; those
remain separate owner decisions.
