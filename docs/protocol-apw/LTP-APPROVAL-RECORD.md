# S1/S3 approval record — candidate, no owner approval entered

**Status: pending owner decision. License: CC BY 4.0.**
This record binds candidate data **and normative prose**. It is not an approval,
a signature, a normative release, S4 evidence or permission to start Phase 2.

## Candidate tuple

```json
{
  "status": "pending-owner-decision",
  "ownerDecision": null,
  "normativeCommit": "df6e284ed81a1b0869c0d7d8a22593921b50641b",
  "corpusVersion": "0.2",
  "schemaBundleDigest": "2-OWDPkYHe3A_DYyUbSsE5t1jFRyNxNM6DnVml-Tp7w",
  "originalCorpusDigest": "fbc9_xl0gKJlfH7JCslUsoOgHoQNrFuVRGdyPKEme0U",
  "corpusDigest": "wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg",
  "numericExtensionDigest": "RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g",
  "normativeFiles": {
    "LTP-SERIALIZATION-DRAFT-v0.1.md": "2ad896594374421897ac1777caeb8b6059df73179f3b5a83979884208f4016eb",
    "APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md": "25aca430a6f50e3256e51cdf8e4364d5c0acc1708b92063eb19d2854764e3fbd",
    "LTP-STACK-ARCHITECTURE.md": "25b449351400f10052f00de3c95841b3c0f04542c2e23eded557534c2ac757ba",
    "LTP-ARTIFACT-CLASSIFICATION.md": "cacb27b316092fecc8173fb679e132e390b7ced40ccd3a978a8045c05e3a3821",
    "LTP-INDEX-DRAFT-v0.1.md": "ebf30fc498b4a06c3c42012c080a2bd724053019ad494a736fc4c805c5daf616",
    "LTP-PROOF-PACKAGE-DRAFT-v0.1.md": "15610e3a57ab4ac317d2fba4f2247caa6370fcd9a044e42da9b0ee7c37433ca6",
    "LTP-STANDARDIZATION-STATUS.md": "71074a01fe6ac1746099fc22d13dc3e8a66ef42c0f373e473281ae37341a3bb4",
    "LTP-S3-COVERAGE.md": "57d30b9b23c7da8dfa0268b3a8e9a6c1ff21f9a243f20b0ef2f9122d02c55704",
    "vectors/ltp/v0.1/README.md": "d133522fcb1448c1f93cc70e558057b80942421efc2f81d8972b8746ccef6427",
    "LTP-CI-REVIEW.md": "62480f5335a1870122ea078da34d5c579ff0784e2becf4c1caedfc81d3bdb5ce",
    "APW-SPEC-v1.3.md": "a768c07e26317a5191c461984b0b12ae644079b9fd735b660f11c37e0ff003f1",
    "SVRI-v1.0.md": "ac14eb1aae745544f5a36ce27736960b99c787fc910225abf5df46debd5273dc",
    "README.md": "e1aec7e912053d91db811a7382b4d71edfe69bec938a48575f710d2ea3699665",
    "LTP-S3-CORE-CLOSURE-PLAN.md": "4eaa2e91b724da924d32d15b04a4469d05dbd1111c812690c6f44b0256241901",
    "vectors/ltp/v0.2/README.md": "600c0a7d16963892c40d606eb18c2e786fbce140ff12fae85e4bd23f43f7ee5b"
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
| Total candidate (`corpusDigest`, v0.2) | SHA-256 of UTF-8 JCS of `vectors/ltp/v0.2/manifest.json`; 51 pinned assets including all initial fixtures, numeric extension and nine new core data files. Contains 285 new core targets, 362 total targets. | Execution of semantic expected verdicts, runtime/transport/budget conformance, tools/README/CI correctness or normative prose. |
| Numeric extension | SHA-256 of UTF-8 JCS of the entire `numeric-serialization.json` object, separately from the original corpus. | Other fixtures, prose, universal Python/Node numeric equivalence, tools or a future signed SVRI/HSVR format. |
| Normative prose commit + byte hashes | Exact committed text of the listed files, including serialization, bootstrap, architecture, classification and proposed S3-core gate. | Approval of that text, unrelated files in the tree, future edits, runtime conformity, cryptographic-backend independence or final publication. |

Data digest rule: unpadded base64url(SHA256(UTF8(RFC8785-JCS(parsedJSON)))).
`normativeFiles` instead uses lowercase hexadecimal SHA-256 of exact file bytes,
including whitespace/newlines. These are intentionally different commitments.

## Owner decision procedure and scope

The owner must cite this record's reviewed Git revision, schema/total-corpus/numeric digests and the preserved original-corpus commitment,
the normative text SHA, and the exact approved scope in a recorded decision.
**Without the text SHA, approval of data does not cover normative prose.** A later
text change requires a new normative commit/hash tuple and renewed owner review;
an asset change requires the affected digest(s), scanner findings and record to
be reviewed again. Old decisions are not transferred silently to a new tuple.

The [S3-core gate for A/B](./LTP-S3-COVERAGE.md) is only proposed. Core coverage
still blocks approval; S3-reputation stays Draft pending its suite and real
emitter evidence. This record currently approves neither scope. Green CI, a
draft-history rewrite or this file's existence never opens A/B or Phase 2.

## Naming-only follow-up (prior review revision)

The owner selected **Local Trust Protocol** as the expansion of LTP. That naming
decision does not approve the S1/S3 corpus: `ownerDecision` above remains null.
That revision superseded the earlier `246cdc8` text pin without changing data
digests and expanded the byte-hash scope to 14 specification files.
The same Git revision contains the editorial glossary/ADR/site updates and the
line-by-line inventory; the portable spec check hashes only specification files
and imports no runtime code. Historical editions and signed data remain intact.

## Authorized static execution — current candidate

The execution instruction authorizes generating CORE-01…06 and consolidating CI,
not approving the resulting corpus. The current record pins the new total
candidate digest above and **df6e284ed81a1b0869c0d7d8a22593921b50641b** prose,
with 15 exact specification-file hashes. The initial corpus, schema bundle and
numeric extension remain byte-for-byte unchanged and retain their digests.
Manual coverage review and the owner's final S3-core scope decision remain open;
`ownerDecision` is null. Inclusion of old reputation/math fixtures in the total
manifest is archival continuity, not approval of S3-reputation or offline DNSSEC.
No artifact/CI result grants permission to implement A/B, run a resolver, acquire
network data or enforce budgets. Static targets are not engine results.
