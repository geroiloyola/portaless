# APW test vectors — machine-readable form (v1.3)

**Normative companion of [`../../APW-VECTORS-v1.3.md`](../../APW-VECTORS-v1.3.md)**, which remains the human-readable form. This directory is **independent of the code**: it does not import, run or reference any implementation. **License**: CC BY 4.0 (see [License and governance](../../APW-SPEC-v1.3.md#license-and-governance)).

## How to use it

Either run the published reference runner against this directory:

```sh
npx @portaless/apw-resolver apw-conformance <this-directory>
```

or read the files directly and check your own implementation. Every expectation in these files is transcribed from the markdown vector document; nothing here invents a value.

## Files

- `manifest.json` — index of the vector files, the spec version, which vectors are the minimal interoperability set, and which vectors are **not yet machine-readable** (with the reason for each).
- `v-*.json` — one file per vector.

## Fixture format

Each vector file is a JSON object with an `id`, `title`, `specSection`, `minimalInterop`, and one or more **arrays of cases**. Each case carries a `kind` that identifies the operation to perform, so a runner dispatches on data rather than on which file it is reading.

`kind` values in use: `fingerprint`, `jcs`, `sha256b64url`, `didKeyId`, `parseDidKeyId`, `parseDidKeyIdRejection`, `manifestBuild`, `manifestParse`, `issuerWeight`, `issuerWeightRatio`, `judgeFromDeviation`, `toValue`, `readerConductToDimension`, `readerConductRejection`, `bayesianScore`, `periodKey`, `selfWeight`, `emitterAgeOk`, `communityPredicate`, `ranking`, `rankingHash`.

A case whose `kind` has no implementation in a runner **must fail**, not pass: an unexecuted vector is not a passing vector.

## Numeric comparison rule

Every numeric expectation is compared within a tolerance, **never with strict equality**.

The reason is documented in `v-08-scoring-primitives.json` under `comparisonRule`: the vector document prints `w(6.7) = 0.9025` as "exact", but in IEEE-754 doubles `((6.7-1)/6)**2` evaluates to `0.9025000000000001`, one ULP above it. An implementation comparing with `===` would fail against a correct implementation. Cases marked `exact: true` are exact in decimal arithmetic and carry tolerance `1e-12`.

## What is not here yet

`manifest.json` → `notYetMachineReadable` lists vectors that are still prose only, each with its reason. Most notably **V-06** (foreign-issuer attestation verification) is part of the minimal interoperability set but is not executable: its 12-step validation order lives in `packages/trust-layer`, not in the published `apw-resolver` package. That is a known, recorded gap, not a silent omission.
