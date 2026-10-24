# S3-core candidate 0.2 — static, pending owner review

This directory contains precalculated targets, not an LTP engine or A/B adapter.
The initial `../v0.1/` corpus is preserved. The total candidate manifest pins
its original assets, numeric extension, and the new CORE-01…06 data files.
Wire protocol versions remain `0.1`; `0.2` versions the test corpus only.

Each case has a concrete ID, direct contract references, coverage tags, a static
input/template patch and literal expected outputs. `proofs.json` supplies fixed
identity/rotation/long-chain templates. `signatures.json` stores exact ASCII JWS
bytes as hex plus public verification metadata; a fixture-only `$jws` reference
expands to those unchanged bytes. Hex avoids duplicating long compact JWS in
every patch and permits arbitrary wire mutations without JSON normalization.
No signing, digest repair or expected-result generation occurs in the consumer.

All keys, sources, domains, clocks and transcripts are **solo pruebas**. They
are not credentials, live DNS observations, trusted production anchors or grants.
RRSIG/offline DNSSEC and reputation remain deferred profiles; this candidate
targets configured DoH/AD and identity history. No real issuer is needed to author
these identity-only targets.

The authoring tool can publish **new candidate files only** and otherwise performs
read-only comparison. It refuses to overwrite any existing different asset.
CI compares frozen files, checks original byte commitments, signatures, schemas,
coverage and arithmetic facts; it does not implement a transport or scheduler.
OpenSSL CLI, Node/JOSE and cryptography share the OpenSSL primitive family.
Cross-checking encodings is not S4 primitive independence.

The owner must review the full manifest digest and bound normative-text revision.
Green CI or complete static targets do not approve S3-core or authorize A/B.

## Complete candidate commitment and review index

Total corpus digest (SHA-256/JCS of `manifest.json`):
**`wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg`**.
The manifest pins 51 parsed JSON assets: 41 initial assets, the initial numeric
extension and nine new core data files. It does not hash this README, tools,
CI, dependency binaries or normative prose. The approval record binds the text
separately. This is a test-corpus version, not a new wire protocol version.

| Area / concrete IDs (examples; full IDs and literal outputs in linked file) | Targets | Direct contract |
|---|---|---|
| [CORE-01](./core-01-bootstrap.json): `CORE-01-valid-root`, `CORE-01-forwarded-ad`, `CORE-01-known-sequence-rollback` | 14 | [Bootstrap §1–3](../../../APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md#1-purpose-and-trust-boundary) |
| [CORE-02](./core-02-doh.json): `CORE-02-valid-txt`, `CORE-02-conflicting-txt`, `CORE-02-transport-fallback`, `CORE-02-no-downgrade` | 42 | [Bootstrap §2–3](../../../APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md#2-shared-parsing-and-binding-rules) |
| [CORE-03](./core-03-did.json): `CORE-03-valid-did`, `CORE-03-private-key`, `CORE-03-ambiguous-method`, `CORE-03-bad-signature` | 23 | [IdentityProof §4](../../../LTP-PROOF-PACKAGE-DRAFT-v0.1.md#4-identityproof-and-independent-roots) |
| [CORE-04](./core-04-history.json): `CORE-04-rotation-valid`, `CORE-04-window-end-inclusive`, `CORE-04-long-1000-step-1/2/3`, `CORE-04-resume-policy-change` | 46 | [History §5](../../../LTP-PROOF-PACKAGE-DRAFT-v0.1.md#5-historyproof-completeness-and-checkpoints), [APW §5.4](../../../APW-SPEC-v1.3.md#54-chained-history-closes-b6) |
| [CORE-05](./core-05-errors.json): `CORE-05-service-01-candidate` through `CORE-05-service-17-deadline_exceeded`, parser and envelope negatives | 39 | [Serialization §2/§6](../../../LTP-SERIALIZATION-DRAFT-v0.1.md#6-result-nulls-reasons-and-http-mapping) |
| [CORE-06](./core-06-resources.json): `CORE-06-dohBytes-below/at/over`, `CORE-06-retry-does-not-reset`, `CORE-06-abort-stream` and 27 dimensions | 121 | [Approved D7 limits](../../../../architecture/resolution-chain-proposal.md#approved-resource-limits), [Package §8](../../../LTP-PROOF-PACKAGE-DRAFT-v0.1.md#8-acceptance-result-validity-and-privacy) |

**285 new core targets** plus the 65 initial targets and 12 numeric cases =
**362 total targets**. [coverage.json](./coverage.json) enumerates every exact ID
and literal reason/stage, while each case file contains the full literal expected
object and direct contract links. A slash in an example above abbreviates three
IDs, not one combined fixture ID. No semantic expected verdict has been executed
by a production LTP verifier.

## Fixture inputs and expectations

- `input.base` selects a fixed template; apply its literal RFC 6902 patch, then
  replace `$jws` references by exact ASCII bytes decoded from the signature bank.
  Do not recompute package/history digests while consuming the case: every repair
  was precalculated in the static patch. Unknown paths/operations fail the audit.
- `input.target` selects the component: bootstrap local context, DoH transcript,
  identity/history proof, service/parser or resource objective. A DoH transcript
  is the acquisition input; the template's online observation is reference
  context, **not permission to bypass a failed transcript**. Fallback cases carry
  explicit ordered attempts, including a null response on transport failure.
- Service results are untrusted offers; a `candidate` HTTP 200 does not itself
  authenticate identity. Resource-bound `accept` means the isolated bound admits
  that amount, not that the complete proof verifies. Both retain proofAccepted
  false and resourceGrant false at that stage. No input claims global latestness.
- CORE-04 uses three real test keys and original Ed25519 signatures. The 1,000-entry
  history completes as 400/400/200 over **three normal quota requests**, retaining
  target/root/key-set/policy binding and the same client window. It is not 1,000
  verifications inside a single 640-attempt operation. Checkpoints and quarantined
  progress stay separate. No prefix creates a grant.
- CORE-06 body recipes are inert, exact bytes (`prefixHex + unitHex repeated N +
  suffixHex`) with precalculated length/hash; signed-entry and public-method
  lists exercise count boundaries. `charges` describe requested work; their
  literal requestedTotal is not a claim that denied work actually ran. Budget
  scheduling, accounting and transport cancellation remain Phase 2 work.
- Raw malformed JSON inputs are targets for a future strict parser. Neither
  JSON.parse nor this audit is asserted to be that parser.
- Local-stage reasons fix a reviewable diagnostic label for the referenced
  invariant. Where the contract requires rejection but does not register an exact
  local code, that label is a candidate convention for manual review, not a new
  wire enum. Service envelopes use exactly the existing 14 registered reasons.

## What was checked

Node native crypto and standard JOSE check all **2,066** unique JWS artifacts:
2,064 have valid primitive signatures, two are deliberate one-bit mutations;
JOSE additionally rejects the signed unsupported-algorithm case (three JOSE
negative artifacts total). Invalid semantic claims may have valid signatures.
The audit checks all 285 schema classifications, frozen byte/hash preimages,
1,000-entry chain links, key-set sort commitments, inclusive key-window facts,
15 body recipes, service reason coverage and exact resource arithmetic facts.
OpenSSL CLI separately checks each signing key, long-chain endpoint samples and
the mutated signatures. These interfaces share OpenSSL, not an independent S4 backend.

```bash
npm run audit:core --prefix docs/protocol-apw
LTP_PYTHON=/tmp/ltp-audit/bin/python npm run check:core --prefix docs/protocol-apw
LTP_PYTHON=/tmp/ltp-audit/bin/python npm test --prefix docs/protocol-apw
```

CI runs these inside the existing required **Unit Tests / unit** job. The compiler
uses pinned cryptography solely for deterministic TEST signing; its `--check`
compares literal files and never regenerates an expectation to accommodate code.
Fixture updates require reviewed/versioned correction and new manifest/record
commitments; scanner exceptions, if needed, remain exact historical findings.
