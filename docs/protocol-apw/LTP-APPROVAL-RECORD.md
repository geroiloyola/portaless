# S1/S3 approval record — candidate, no owner approval entered

**Status: pending owner decision. License: CC BY 4.0.**
This record binds candidate data **and normative prose**. It is not an approval,
a signature, a normative release, S4 evidence or permission to start Phase 2.

## Candidate tuple

```json
{
  "status": "pending-owner-decision",
  "ownerDecision": null,
  "normativeCommit": "246cdc8619e13147374473d8796028a3b0ccce3d",
  "schemaBundleDigest": "2-OWDPkYHe3A_DYyUbSsE5t1jFRyNxNM6DnVml-Tp7w",
  "corpusDigest": "fbc9_xl0gKJlfH7JCslUsoOgHoQNrFuVRGdyPKEme0U",
  "numericExtensionDigest": "RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g",
  "normativeFiles": {
    "LTP-SERIALIZATION-DRAFT-v0.1.md": "2ad896594374421897ac1777caeb8b6059df73179f3b5a83979884208f4016eb",
    "APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md": "25aca430a6f50e3256e51cdf8e4364d5c0acc1708b92063eb19d2854764e3fbd",
    "LTP-STACK-ARCHITECTURE.md": "4c523dde9829fb53dc36ddd7060d04e21210e5e42cbf26080c85b92958c6a595",
    "LTP-ARTIFACT-CLASSIFICATION.md": "cacb27b316092fecc8173fb679e132e390b7ced40ccd3a978a8045c05e3a3821",
    "LTP-INDEX-DRAFT-v0.1.md": "ebf30fc498b4a06c3c42012c080a2bd724053019ad494a736fc4c805c5daf616",
    "LTP-PROOF-PACKAGE-DRAFT-v0.1.md": "15610e3a57ab4ac317d2fba4f2247caa6370fcd9a044e42da9b0ee7c37433ca6",
    "LTP-STANDARDIZATION-STATUS.md": "219e99b08b0e5eaad252a5945ad4f88e8f095286a3aaf4ebf31c17df6f1499f4",
    "LTP-S3-COVERAGE.md": "00348479a3e19bdbdff43231153a435afa8b98d1f4b905ef990ebaf43506cad8",
    "vectors/ltp/v0.1/README.md": "d133522fcb1448c1f93cc70e558057b80942421efc2f81d8972b8746ccef6427",
    "LTP-CI-REVIEW.md": "bf62e1b32521f7178b8b111764c51473ddeb397d1e410f0f96c52f54287c1944"
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
| Original corpus | SHA-256 of UTF-8 JCS of `vectors/ltp/v0.1/manifest.json`; its entries pin 41 parsed JSON fixture assets. Original signed JWS strings and DNS wire base64url strings inside fixtures are preserved in those commitments. | README/tools, Python/Node correctness, missing coverage, execution of the 37 resolution targets, live DNS/emitters, numeric extension or normative text. |
| Numeric extension | SHA-256 of UTF-8 JCS of the entire `numeric-serialization.json` object, separately from the original corpus. | Other fixtures, prose, universal Python/Node numeric equivalence, tools or a future signed SVRI/HSVR format. |
| Normative prose commit + byte hashes | Exact committed text of the listed files, including serialization, bootstrap, architecture, classification and proposed S3-core gate. | Approval of that text, unrelated files in the tree, future edits, runtime conformity, cryptographic-backend independence or final publication. |

Data digest rule: unpadded base64url(SHA256(UTF8(RFC8785-JCS(parsedJSON)))).
`normativeFiles` instead uses lowercase hexadecimal SHA-256 of exact file bytes,
including whitespace/newlines. These are intentionally different commitments.

## Owner decision procedure and scope

The owner must cite this record's reviewed Git revision, all three data digests,
the normative text SHA, and the exact approved scope in a recorded decision.
**Without the text SHA, approval of data does not cover normative prose.** A later
text change requires a new normative commit/hash tuple and renewed owner review;
an asset change requires the affected digest(s), scanner findings and record to
be reviewed again. Old decisions are not transferred silently to a new tuple.

The [S3-core gate for A/B](./LTP-S3-COVERAGE.md) is only proposed. Core coverage
still blocks approval; S3-reputation stays Draft pending its suite and real
emitter evidence. This record currently approves neither scope. Green CI, a
draft-history rewrite or this file's existence never opens A/B or Phase 2.
