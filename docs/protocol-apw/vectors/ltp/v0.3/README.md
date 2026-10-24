# Composed A→B candidate v0.3 — G1 review only

This version adds the static master `AB-STATIC-01` and six controlled negatives
`AB-STATIC-02`…`AB-STATIC-07`. It preserves v0.1/v0.2 and all signed bytes used
from those candidates. It does not execute the described acquisition/verification
flow. Authorization definitions and states exist only in the
[canonical register](../../../LTP-GATES-AND-AUTHORIZATIONS.md).

The trace uses configured DoH plus a configured Index carrying a complete
identity-only package. B consumes the frozen handoff offline; it has no outgoing
request. Source signed material is the preserved three-key rotation history in
v0.2. The master makes source bytes, extracted TXT, root/key/manifest/history
commitments, transferred context, candidate prefix states and resource arithmetic
explicit. Expected consumption and results are literal targets, never observations.

`materials.json` stores exact bytes as hex. Every byte reference is SHA-256 of
those bytes; JSON values use JCS where declared. Each case contains explicit
producer/consumer bindings, mathematical facts, direct contracts, source CORE
references and literal expected results. Unconsumed tails are proposed data, not
trusted states. No checkpoint or prefix creates resource authorization.

The asset assembler only freezes already-specified data/byte algebra and refuses
to replace differing assets. The read-only audit checks hashes, schema facts,
standard-library signature primitives and declared byte/number relations. It
never selects a provider/key/policy, derives an LTP semantic verdict, interprets
steps as operations, sends a transcript, schedules work or updates a real counter.
Current primitive checks share OpenSSL; S4 is not claimed.

`sourceTemplate` identifies the actual frozen byte origin. `sourceCoreCases`
maps the six invariant families, not a claim that mutually different one-key
component inputs were concatenated. All acquired/selected/transferred bodies
and state records are explicit bytes in the v0.3 material bank. TLS metadata is
a controlled fixture assumption, not an observed TLS session or DNSSEC proof.

## Candidate commitment and exact case IDs

Total manifest digest: **`wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA`**
(unpadded base64url SHA-256 of UTF-8 RFC 8785/JCS of `manifest.json`).
It pins 61 assets: the 51 inherited assets, the preserved v0.2 manifest itself,
seven composed fixtures, the byte-material bank and the coverage index. This is
369 total targets (362 preserved plus seven composed targets). It does not hash
this README, tools, CI or normative prose; the approval record binds text separately.

| Exact ID | Controlled change from the master | Literal expected target |
|---|---|---|
| [AB-STATIC-01](./ab-static-01.json) | Complete identity-only package, independent DoH root, three-key signed history, fixed consumer policy and shared context | identity=verified; history=verified; proofAccepted=true; effectiveValidUntil=1790000060 |
| [AB-STATIC-02](./ab-static-02.json) | AD=false; the package transcript is not consumed and B receives no handoff | dnssec_required; history=not_started; acquisitionConsumed=[true,false] |
| [AB-STATIC-03](./ab-static-03.json) | DID public key replaced by a retired key; actual signatures and all outer commitments remain mathematically valid | key_mismatch; no log slice consumed |
| [AB-STATIC-04](./ab-static-04.json) | Prefix output and next input differ only in trustPolicyDigest | checkpoint_required before B-LOG-2; no splice |
| [AB-STATIC-05](./ab-static-05.json) | Same 10,000 ms deadline: A=2,500+2,500; bindings/log/gap=1,000+3,999+1 | deadline_exceeded before B-LOG-2; no reset |
| [AB-STATIC-06](./ab-static-06.json) | TTL=1 s; handoff is live at entry and stale at the 2 s wall-clock target, operation still below 10 s | freshness_unproven before promotion; history=verified but proofAccepted=false |
| [AB-STATIC-07](./ab-static-07.json) | Required second log signature is a preserved one-bit mutation, with outer history/package hashes precalculated again | bad_signature; history=invalid |

All seven have resourceGrant=false, reputationAdmitted=false,
implementationAuthorized=false and semanticVerdictObserved=false. Expected
consumption means the **target disposition**, never a trace executed by the audit.
The failure in AB-STATIC-07 also breaks the subsequent `prev` byte relation, which
is recorded as false; the unconsumed suffix cannot mask the earlier bad signature.
AD=false yields an A failure record with no authenticated root/package, not a
fallback root borrowed from a template.

## Byte and mathematical evidence

The master contains two inert HTTP body transcripts, producer/consumer handoff
records, proposed B prefix-state inputs/outputs, public JWK and signature
preimages, and fixed clock/resource operands. The audit anchors these facts to
the actual body bytes: TXT extraction at the recorded pointer; offered package
JCS/hash; root/current-JWK thumbprints; sorted key-set binding; signed stable
target; context policy/config/operation/client/root scopes; prefix hashes and
unchanged HTTP/body counters. B's proposed signature counts are 2/3/4/5 for
bindings and three log attempts. Candidate states remain quarantined proposals.

There are 79 frozen byte materials, six identical A→B handoffs, one absent
handoff, 14 declared byte relations, 52 number relations and 35 signature facts
(including repeated case evidence and one actual negative signature fact).
Node crypto and JOSE verify the supplied primitive facts; no overall identity
verdict is derived. AB-STATIC-05 fixes the exclusive deadline comparison at
10,000 < 10,000 = false and the incorrect-reset counterexample at 5,000 < 10,000
= true. No timer, reservation, queue, retry or budget admission code is supplied.

The manifest and [coverage index](./coverage.json) identify all data for manual
review. Each case carries direct contract links and invariant-family source IDs.
Passing these asset checks is not proof that a running A/B system meets its
targets or that the reviewer has accepted sufficiency. Project permissions are
not inferred from expected node-level verdicts; see the canonical register.

```bash
npm run check:ab --prefix docs/protocol-apw
npm run audit:ab --prefix docs/protocol-apw
```

These run in the already-required Unit Tests/unit job. A negative test disconnects
the consumer reference **after** frozen-asset checks and must fail the actual byte
binding assertion. Thus a valid outer commitment is not substituted for checking
the inner transfer relation. Updates require a reviewed/versioned candidate and
new manifest/record commitments; prior revisions are never overwritten.
