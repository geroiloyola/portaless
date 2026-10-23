# PR #104 — thematic commit review guide

**Status: Draft; review by linstarkcorp, owner decision/merge. License: CC BY 4.0.**
Only the draft branch history was rewritten. `main` and other branches were not
rewritten. The previous mixed `24559d0` and scanner follow-up `8abf10b` are replaced
by the following thematic sequence; the heap follow-up commit is preserved.
Review the complete series/head: prose links to the approval record become
resolvable in the final binding commit. Intermediate commits are review units,
not independently approved or deployable snapshots.

| Commit | Topic | What to review |
|---|---|---|
| `f762837` | #102 heap regression, preserved | Fixed seed, all set/update/remove/pop paths, parent/child order, exact positions and model comparison after every operation. No production heap edits. |
| `adf5593` | S1 schemas | Five closed/typed candidate schemas, null/absence and profile constraints; manifest commitments. No normative prose is covered by these digests. |
| `9ed8868` | Vectors and tools | Static original signed bytes, 41-asset manifest and separately pinned numeric extension; isolated package/lock, Python author, Node/native/JOSE/OpenSSL/dnspython cross-checks and numeric/tamper tests. Shared backend versions must be disclosed; no LTP engine verdicts are claimed. |
| `246cdc8` | Documentation / normative prose | Serialization, bootstrap scope, architecture, classification, S3-core gaps/proposed A/B criterion, shared primitive-backend limitation, CI observation/proposal and test-only fixture notes. Review contract regressions; no gate approval, formulas or signed bytes changed. **This is the normative text SHA pinned in the approval record.** |
| `dc4ecca` | CI / documentation lint | Separate spec dependency installation; standalone cross-check job; root lint in existing required suites; positive/negative link-boundary and CI-scope tests. Moving cross-check into a required job is proposed in prose only; no protection settings changed. |
| `e3af413` | Scanner fixtures | 28 individually labeled `solo pruebas` findings, exact introducing-commit fingerprints rebound to `9ed8868`; literal key/seed/token/digest non-reuse in tracked production source with an injected negative. No path/rule-wide exclusion. |
| Final commit titled `docs(ltp): bind approval tuple to normative prose and review history` | Approval binding and this guide | Three candidate data digests plus full `246cdc8619e13147374473d8796028a3b0ccce3d` text SHA and per-file byte hashes. Check that all ten prose files match that Git revision, mutations fail the record check, and `ownerDecision` remains null. This commit cannot contain its own SHA; cite its Git revision in any future owner decision. |

The owner has not approved S1/S3-core through this rewrite. S3-reputation and S4
remain Draft/open; no A/B, engine, network, budget or repository extraction starts.

## Rewrite verification evidence

Local checks before updating the draft remote:

```bash
git diff --exit-code 8abf10be93836d07f9e536aa19f61e7be8b9a182 HEAD -- docs/protocol-apw/schemas 'docs/protocol-apw/vectors/ltp/v0.1/*.json'
git range-diff f762837..8abf10b f762837..HEAD
node docs/protocol-apw/tools/approval-record.mjs
```

The first comparison checks exact asset bytes, not only parsed JSON/JCS; the
second exposes the commit redistribution and review refinements. The old draft
objects are local review provenance, not prerequisites for an extracted package.
The record checker verifies hashes without importing runtime code or requiring Git.
The prose commit is checked separately against Git before push. CI tests validate
the final series; no intermediate green badge is asserted.
