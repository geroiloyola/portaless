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
| `246cdc8` | Original documentation / normative prose | Serialization, bootstrap scope, architecture, classification, S3-core gaps/proposed A/B criterion, shared primitive-backend limitation, CI observation/proposal and test-only fixture notes. Review contract regressions; no gate approval, formulas or signed bytes changed. Historical text pin, superseded by the owner-naming follow-up below. |
| `dc4ecca` | CI / documentation lint | Separate spec dependency installation; standalone cross-check job; root lint in existing required suites; positive/negative link-boundary and CI-scope tests. Moving cross-check into a required job is proposed in prose only; no protection settings changed. |
| `e3af413` | Scanner fixtures | 28 individually labeled `solo pruebas` findings, exact introducing-commit fingerprints rebound to `9ed8868`; literal key/seed/token/digest non-reuse in tracked production source with an injected negative. No path/rule-wide exclusion. |
| `4faeccd` | Original approval binding and this guide | Previously bound three data digests to the `246cdc8` text SHA and ten file hashes. Preserved review provenance, not the current tuple. The follow-up below replaces that text binding without changing data digests. |

The owner has not approved S1/S3-core through this rewrite. S3-reputation and S4
remain Draft/open; no A/B, engine, network, budget or repository extraction starts.

## Owner naming follow-up (appended, no new history rewrite)

| Commit | What to review |
|---|---|
| `e6df65b` | Local Trust Protocol as unique live expansion; inventory of 24 pre-edit matching lines (10 live, 14 historical, zero signed identifiers); continuity and author credit; old section anchor preserved. Root Vitest naming lint rejects retired/other expansions outside explicit history. CORE-01…06 explains what A/B still need; no vectors or runtime implementation added. |
| `66e2b03` | Historical naming binding: **e6df65b976c63b4e14a2212eb36b68ece021fb18**, 14 exact spec-file hashes and the same three data digests; `ownerDecision: null`. Superseded by later candidate bindings. |

The current review/approval tuple is always the explicit one in
[LTP-APPROVAL-RECORD.md](./LTP-APPROVAL-RECORD.md). The naming decision is not
S3-core coverage acceptance. The subsequent static-execution revision below
adds targets, not owner approval; a digest cannot waive an A/B prerequisite.

## Authorized S3-core static execution (v0.2 review history)

| Commit | What to review |
|---|---|
| `987c745` | The complete standalone package checks now run inside the existing required Unit Tests/unit job, including pinned Python dependencies. Separate workflow removed; no coverage threshold or protection-setting changes. |
| `df6e284` | Total versioned v0.2 manifest, all 285 CORE-01…06 case IDs with literal expected results/direct contracts, signature bank, 3-key rotation and signed 1,000-entry segmented chain, resource recipes and negative byte/crypto targets. Check actual primitive evidence separately from the unexecuted semantic verdicts. Initial v0.1/schemas and all production modules are unchanged. |
| `5b89748` | Historical v0.2 binding: total digest **wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg**, preserved original/schema/numeric digests and **df6e284ed81a1b0869c0d7d8a22593921b50641b** prose (15 files). Owner decision remains null and A/B remains blocked. |

For the preserved component candidate, see [v0.2 README](./vectors/ltp/v0.2/README.md) and
[coverage.json](./vectors/ltp/v0.2/coverage.json). Each area file contains every
exact input patch, expected result and direct contract reference. The static
audit verifies hashes, schemas, signatures, encodings and arithmetic facts, not
the future engine, parser, network or scheduler. S4 independence remains open.

## Composed static v0.3 correction — current candidate

Start with the [canonical G1–G5 register](./LTP-GATES-AND-AUTHORIZATIONS.md), then
the [v0.3 README](./vectors/ltp/v0.3/README.md) and
[coverage index](./vectors/ltp/v0.3/coverage.json). G1 sufficiency is pending manual
review; G2–G5 are blocked. No publication, hash, CI result, acceptance or merge
automatically changes an authorization state.

The total v0.3 digest is **wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA**.
AB-STATIC-01 binds acquisition bytes to the offline verification input, proposed
prefix states, independent root, signed three-key history and shared resource
context. AB-STATIC-02…07 provide the six controlled negatives. Review the actual
material references and inner relations, not only the outer manifest commitment.
The audit checks byte algebra, fixed arithmetic and signature primitives; it
does not execute the trace or calculate the literal LTP verdicts.

The current [approval tuple](./LTP-APPROVAL-RECORD.md) binds the final prose Git
SHA, 17 exact spec-file hashes, preserved commitments and v0.3. Its scope is
`G1-static-corpus-only` with `ownerDecision: null`. The binding follows the prose
commit to avoid a self-referential SHA; this guide is not part of that hash scope.
All follow-ups append to the existing Draft PR #104; no new history rewrite.

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
