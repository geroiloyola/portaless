# S1/S3 approval record — accepted G1 decision

**Status: G1 accepted by the owner on 2026-10-24. License: CC BY 4.0.**
This record binds the reviewed corpus data **and normative prose**. It is not a
normative release, S4 evidence, a G2–G5 authorization or permission to deploy.

## Candidate tuple

```json
{
  "status": "approved",
  "ownerDecision": {
    "decision": "approved",
    "scope": "G1-static-corpus-only",
    "decidedAt": "2026-10-24",
    "reviewer": "linstarkcorp",
    "reviewedCommit": "3ff080b42481e9321b449cec6e4e78ae5a9c9653",
    "mergeCommit": "7fd939fda0e2570e5c18dfbe0e555483b52b449f",
    "corpusDigest": "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA"
  },
  "decisionScope": "G1-static-corpus-only",
  "normativeCommit": "cda05806f709ced4b737bf5c1bcedfb5c26f10d2",
  "corpusVersion": "0.3",
  "schemaBundleDigest": "2-OWDPkYHe3A_DYyUbSsE5t1jFRyNxNM6DnVml-Tp7w",
  "originalCorpusDigest": "fbc9_xl0gKJlfH7JCslUsoOgHoQNrFuVRGdyPKEme0U",
  "previousCorpusDigest": "wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg",
  "corpusDigest": "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA",
  "numericExtensionDigest": "RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g",
  "normativeFiles": {
    "LTP-SERIALIZATION-DRAFT-v0.1.md": "2177d9f5153922519b50e1c4a70091e4063a66ac3072193bc4ece50c09910979",
    "APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md": "25aca430a6f50e3256e51cdf8e4364d5c0acc1708b92063eb19d2854764e3fbd",
    "LTP-STACK-ARCHITECTURE.md": "1fa86bc13c0d088fe556eb6e2dff4cda72c42d6e3125b80cc6b736d309662bab",
    "LTP-ARTIFACT-CLASSIFICATION.md": "006d09eded39dd8d7fd6b58efe2afd6589f8316b1a274076c1f2cd5373d571c9",
    "LTP-INDEX-DRAFT-v0.1.md": "40493018a9c66965c3bc49763978d66a6a394169df000ab672248f412d858b4f",
    "LTP-PROOF-PACKAGE-DRAFT-v0.1.md": "15610e3a57ab4ac317d2fba4f2247caa6370fcd9a044e42da9b0ee7c37433ca6",
    "LTP-STANDARDIZATION-STATUS.md": "4870c6fb212e53101e9210aa9d0c60d381527a76c38498e2dbc20ba902a27cbc",
    "LTP-S3-COVERAGE.md": "54f93134e092fe1200a5646824c2623ec8df851bd38ddb63a1e1f1e25ed4db9e",
    "vectors/ltp/v0.1/README.md": "d133522fcb1448c1f93cc70e558057b80942421efc2f81d8972b8746ccef6427",
    "LTP-CI-REVIEW.md": "fa6d34696b03c8d3de3d918661a47fc091d936d89ca7b191e76dcd5978215d06",
    "APW-SPEC-v1.3.md": "a768c07e26317a5191c461984b0b12ae644079b9fd735b660f11c37e0ff003f1",
    "SVRI-v1.0.md": "ac14eb1aae745544f5a36ce27736960b99c787fc910225abf5df46debd5273dc",
    "README.md": "010aa19f9516215ccf4f1a5e1a81e6dcaf1b0e141ed4c9e1375705dc796fcafe",
    "LTP-S3-CORE-CLOSURE-PLAN.md": "3fac0432b27c2e3970b53fe0295060d7f365123cca06a7d753794319bb7cf0ef",
    "vectors/ltp/v0.2/README.md": "600c0a7d16963892c40d606eb18c2e786fbce140ff12fae85e4bd23f43f7ee5b",
    "LTP-GATES-AND-AUTHORIZATIONS.md": "c7148264e744c99f61e214d5315b3eba08b74a921f24eb183e6d98012f0cd5e8",
    "vectors/ltp/v0.3/README.md": "773f27c1b26562c58c2ba297bd623b44967f717d7af71fe0aeea7144069c60e6",
    "LTP-G2-G3-IMPLEMENTATION-SCOPE.md": "69b178515a78ed1b10ffa473f882963ac524ebb0cfdd33338d4583e2c33b1660"
  }
}
```

`normativeCommit` identifies the commit containing the exact candidate
serialization, bootstrap, architecture and classification prose, plus the
Index/package, gate/coverage and vector notes listed in `normativeFiles`.
Those byte SHA-256 values make an accidental later text edit detectable without
requiring a Portaless import or a Git repository in the standalone asset package.
The commit SHA is a Git identifier, not a fourth JCS digest or a signature.

## What each commitment covers — and does not cover

| Commitment | Covers | Does not cover |
|---|---|---|
| Schema bundle | SHA-256 of UTF-8 JCS of `schemas/v0.1/manifest.json`; its five entries pin each parsed schema by SHA-256/JCS. | Markdown prose, schema-file whitespace, corpus, numeric extension, tools, dependencies, runtime or an approval. |
| Original corpus (`originalCorpusDigest`) | SHA-256 of UTF-8 JCS of `vectors/ltp/v0.1/manifest.json`; 41 original parsed assets, unchanged. | Numeric extension, new core assets, tools, prose, live behavior or new approval of reputation profiles. |
| Previous candidate (`previousCorpusDigest`, v0.2) | SHA-256 of UTF-8 JCS of the preserved `vectors/ltp/v0.2/manifest.json`; 51 pinned assets and 362 total targets. | Approval, new composed cases or execution of semantic verdicts. |
| Total candidate (`corpusDigest`, v0.3) | SHA-256 of UTF-8 JCS of `vectors/ltp/v0.3/manifest.json`; 61 pinned assets including the inherited corpus, preserved v0.2 manifest and nine composed data files. Contains 369 total targets. | Execution of semantic expected verdicts, runtime/transport/budget conformance, tools/README/CI correctness or normative prose. |
| Numeric extension | SHA-256 of UTF-8 JCS of the entire `numeric-serialization.json` object, separately from the original corpus. | Other fixtures, prose, universal Python/Node numeric equivalence, tools or a future signed SVRI/HSVR format. |
| Normative prose commit + byte hashes | Exact committed text of the listed files, including serialization, bootstrap, architecture, classification and proposed S3-core gate. | Approval of that text, unrelated files in the tree, future edits, runtime conformity, cryptographic-backend independence or final publication. |

Data digest rule: unpadded base64url(SHA256(UTF8(RFC8785-JCS(parsedJSON)))).
`normativeFiles` instead uses lowercase hexadecimal SHA-256 of exact file bytes,
including whitespace/newlines. These are intentionally different commitments.

## Owner decision procedure and scope

`ownerDecision` applies only to **G1 static corpus acceptance**, never to
implementation permission. Definitions and current authorization states exist
only in [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).

The owner must cite this record's reviewed Git revision, schema/total-corpus/numeric digests and the preserved original-corpus commitment,
the normative text SHA, and the exact approved scope in a recorded decision.
**Without the text SHA, approval of data does not cover normative prose.** A later
text change requires a new normative commit/hash tuple and renewed owner review;
an asset change requires the affected digest(s), scanner findings and record to
be reviewed again. Old decisions are not transferred silently to a new tuple.

The [S3-core coverage evidence](./LTP-S3-COVERAGE.md) is accepted for the
identified G1 corpus. Reputation profiles await their separate suite and real
emitter evidence. This record does not approve G4 or G5. Green CI, publication,
acceptance or merge did not open G2/G3; the owner recorded those decisions
separately in the canonical register.

## Naming-only follow-up (prior review revision)

The owner selected **Local Trust Protocol** as the expansion of LTP. That naming
decision did not itself approve the S1/S3 corpus. That revision superseded the earlier `246cdc8` text pin without changing data
digests and expanded the byte-hash scope to 14 specification files.
The same Git revision contains the editorial glossary/ADR/site updates and the
line-by-line inventory; the portable spec check hashes only specification files
and imports no runtime code. Historical editions and signed data remain intact.

## Accepted static composition — G1 decision

The owner accepted the static AB-STATIC-01…07 corpus after `linstarkcorp`'s
review. The tuple above pins the accepted total corpus digest and the exact
specification prose with 18 file hashes. The initial corpus, v0.2, schema bundle
and numeric extension retain their bytes and commitments. `decisionScope` is
`G1-static-corpus-only`. Inclusion of old reputation/math fixtures is archival
continuity, not approval of advanced profiles or offline DNSSEC.

G1 did not itself authorize implementation. The owner recorded separate bounded
G2/G3 decisions in [LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md);
G4/G5 remain blocked. No artifact/CI result expands that scope. The identity-only
engine's matching test results are not a deployment or S4 claim.
