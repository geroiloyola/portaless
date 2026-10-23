# LTP Stack — identity, trust, outputs and verifiable history

**Status:** owner-approved architecture and contract baseline (2026-10-23);
formal closure and remaining gates are recorded in
[contract approval and standardization gates](./LTP-STANDARDIZATION-STATUS.md).
No runtime, repository or adopted wire-format migration is performed by this document.
**License:** CC BY 4.0.

The stack's principal concern is **trust and traceability**, evaluated by LTP.
It is specified independently of programming language, vendor and reference
implementation. Portaless names a runtime/reference implementation, not the
protocol, an Index authority or the proof-package format.

## 1. Layer responsibilities

| Layer | Responsibility | What it does not establish by itself |
|---|---|---|
| **APW — identity and structure** | `did:apw`, domain/key binding, original signed artifacts, structural links between state transitions, peer-to-peer identity/state exchange and the DNS-anchored log format. | A signature/state hash does not determine trustworthiness, reputation, truthful content or authorization. |
| **LTP — trust and traceability engine** | Audits APW chain continuity/provenance, verifies and selects LTP Attestations, evaluates witnesses, evidence completeness/freshness and trust-policy inputs, and computes evidence-weighted trust results. | An LTP result is not universal truth or an automatic resource grant. Missing proof stays missing; explicit policy still governs interaction. |
| **SVRI — consumable output vector** | Versioned projection of an LTP calculation: score where applicable, provenance/counts, effective evidence/inference flags and qualitative level under the profile's public/admin contract. | A scalar score or an unsigned/signed declaration alone is not independently reproduced trust. Identity may verify while SVRI remains pending. |
| **HSVR — retained/verifiable history of SVRI** | Historical SVRI outputs tied to their evaluated subject/revision or chain snapshot, evaluation time, rules version and supporting proof references; persistent materialization or verified reconstruction preserves their provenance. | A stored number without its snapshot, rules and evidence is not verified history; the current SVRI cannot fill a missing past output. |

The APW log is the structural evidence/state history; **HSVR is the history of
the SVRI results derived from LTP evaluation of that evidence**. They are not
two names for the same log. Persisting HSVR is a storage/runtime operation, not
an assertion that every existing implementation already stores historical outputs.
The adopted SVRI/HSVR contract continues to mark unverifiable history partial
and to restrict administrative detail to authorized consumers.

## 2. Logical flow

```text
HTTP/TLS and a bounded acquisition transport
                ↓
APW: who signed + identity/state structure + original artifacts
                ↓
LTP: audit chains, verify sources, evaluate witnesses and evidence
                ↓
SVRI Projection: the consumable trust/evidence output
                ↓
HSVR: retained outputs and/or verified historical reconstruction
```

These are logical protocol responsibilities, not new OSI transport layers.
LTP uses APW identity/state data over existing transports; it does not replace
HTTP/TLS, fix a socket by cryptographic calculation, or make transport claims
true merely by assigning a layer name. APW may exchange signed state without
running a reputation calculation; LTP may evaluate existing local APW proofs
without performing a new peer connection.

## 3. Standard service and format names

- **LTP Index:** distributes/discovers trust and traceability proofs. It may
  cache original APW artifacts and LTP evidence, but cannot become their authority.
- **LTP Proof Package:** the neutral container that carries APW identity/state
  proof and LTP evidence to an independent verifier. Its trust purpose determines
  its name; containing APW data does not turn it into an APW identity format.
- **APW Identity Bootstrap:** authenticates the domain/key root independently
  of the LTP Index. `did:apw`, `_apw`, APW manifest/log/key-set artifact identifiers
  remain in the identity/structural layer.
- **LTP Attestation:** an issuer-signed observation consumed by LTP. Its adopted
  APW JWS representation remains `apw-attestation+jws`; terminology does not
  rewrite existing signed bytes.
- **SVRI Projection:** an output, not another identity proof.
- **HSVR:** the verifiable historical output record/reconstruction, not a second
  trust authority or a substitute for retained source evidence.

Normative-format drafts, separate from runtime implementation plans:

1. [LTP Index Draft 0.1](./LTP-INDEX-DRAFT-v0.1.md).
2. [LTP Proof Package Draft 0.1](./LTP-PROOF-PACKAGE-DRAFT-v0.1.md).
3. [APW Identity Bootstrap Draft 0.1](./APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md).
4. [Adopted SVRI v1.0 / HSVR contract](./SVRI-v1.0.md).

## 4. Compatibility and publication boundary

APW v1.3 currently collects identity, history, LTP and related contracts in one
published document. This conceptual split does not silently amend its algorithms,
fields, scopes, public/admin rules or independent vectors. It clarifies which
layer owns each concern while future specifications can be organized separately.

The unpublished Draft 0.1 Index/package names are corrected to `LTP Index`,
`ltp-resolution-request`, `ltp-resolution-result` and `ltp-proof-package` before
adoption. Their former APW-prefixed draft names are not new compatibility aliases.
Unknown format identifiers fail closed rather than being guessed.

Existing deployed identifiers such as `typ: apw-index`, `apw-log+jws`,
`apw-attestation+jws`, `did:apw`, and their current paths remain unchanged.
`apw-index` is the historical witness-directory representation of an LTP trust
role, not the new proof-package service. A runtime rename of existing bytes,
endpoints, packages or storage requires a separate migration/version decision.
Historical/archive documents retain their original names and context.

Go, Rust, Nuvid or other engines should obtain the same result from the same
APW proofs, LTP rules/trust policy and evaluation time, and emit conforming SVRI
and verifiable historical results. No private runtime source, database schema,
class or hosted service is a normative dependency. The owner has approved the
three Draft 0.1 contracts as the implementation baseline, including independent
identity bootstrap and the restrictive resource budget. Final publication still
requires independent vectors and compatible verification implementations.
Workers/Edge indexed-egress programming is blocked until the documentation commit
containing this baseline is merged; activation remains gated by conformance and
runtime acceptance.

## 5. Future specification repository

`ltp-stack` communicates the complete identity → trust → output/history stack;
`ltp-protocols` communicates a collection of independent specifications. Either
can organize APW, LTP, SVRI/HSVR and conformance resources as separate documents
or RFC families, with implementation repositories kept distinct.

The owner has approved the trust-centered conceptual direction, **not an actual
repository rename, extraction, submodule layout or remote/package migration**
through this document. Such an operation requires its own explicit execution
request. No naming choice makes a network, independent emitters or a deployed
LTP Index exist before they have real operators and evidence.
