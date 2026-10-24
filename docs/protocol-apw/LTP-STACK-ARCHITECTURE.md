# LTP Stack — identity, trust, outputs and verifiable history

**Status:** owner-approved architecture and contract baseline (2026-10-23);
formal closure and remaining gates are recorded in
[contract approval and standardization gates](./LTP-STANDARDIZATION-STATUS.md).
No runtime, repository or adopted wire-format migration is performed by this document.
**License:** CC BY 4.0.

**Review additions below are Draft proposals**, not newly approved architecture.
They change no signed bytes, adopted identifiers or scoring formulas.

The stack's principal concern is **trust and traceability**, evaluated by LTP.
It is specified independently of programming language, vendor and reference
implementation. Portaless names a runtime/reference implementation, not the
protocol, an Index authority or the proof-package format.

## 1. Layer responsibilities

**Owner naming decision (2026-10-23): LTP = Local Trust Protocol.** Each node
applies its own local policy to verified evidence. **LTP Stack** is the complete
APW + LTP + SVRI + HSVR set, not an expansion of the LTP acronym. This editorial
clarification preserves attribution to Gerardo Loyola in authorship and Annex A,
all adopted identifiers and signed bytes, and existing formulas.

| Layer | Responsibility | What it does not establish by itself |
|---|---|---|
| **APW — identity and structure** | `did:apw`, domain/key binding, original signed artifacts, structural links between state transitions, peer-to-peer identity/state exchange and the DNS-anchored log format. | A signature/state hash does not determine trustworthiness, reputation, truthful content or authorization. |
| **LTP — deterministic trust/traceability core** | Audits APW chain continuity/provenance, signatures, issuer bindings, completeness/freshness and explicit policy inputs. Given identical bytes, anchors, policy, checkpoints and time, produces the same proof verdict. Scoring runs only under a separately selected versioned profile. | A proof verdict is not a scalar reputation score, universal truth or a resource grant. Missing proof stays missing. |
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
fields, scopes, public/admin rules or published vectors (verificación cruzada, mismo autor). It clarifies which
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
requires vectors with explicit authorship and compatible externally reviewed verifiers.
Current implementation permissions are defined only in the
[canonical gates register](./LTP-GATES-AND-AUTHORIZATIONS.md). The baseline merge
is historical architecture evidence, not a trigger for programming. Static corpus
approval did not itself grant engine, network, resource or deployment
authorization; G2/G3 were separately authorized for identity-only work.

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

## 6. Deterministic core versus optional profiles — Draft

The core binds exact inputs and proves structural/cryptographic admissibility.
It does not require SVRI, HSVR, a public Index, a numeric score or Portaless.
SVRI and the semantic HSVR reconstruction belong to optional **versioned scoring
profiles**. They are deterministic only given that profile's rules, admissible
evidence, explicit issuer trust/calibration policy and evaluation time. HSVR
storage, retention, admin authorization and materialized views are runtime work.
An omitted profile produces no score; it does not select a default scoring model.
The existing site-log scored profile still requires its full Calculation when
selected. This conceptual split does not remove fields from an existing message.
See the [one-page classification and PR3 boundary](./LTP-ARTIFACT-CLASSIFICATION.md).

## 7. Conformance roles — Draft

| Role | Required evidence / responsibility |
|---|---|
| Issuer | Publish original signed claims with exact `typ`, issuer/subject, key binding, time, scope and uniqueness semantics; signatures prove attribution, not truth. |
| Verifier | Declare supported versions/profiles; authenticate roots outside the relay, check original bytes and every required proof, expose incomplete/unsupported/failure separately, reproduce selected profiles without granting resources. |
| Relay / Index | Preserve original signed bytes and declared envelope commitments; echo request binding, respect audience/expiry, never label its own package cryptographically verified for a consumer or install trust anchors. |
| Consumer | Select verifier/profile, anchors, clock and policy explicitly; consume only the appropriate verdict/audience; make grants and resource admission separately. A consumer may also implement the verifier role. |

Conformance is role + version + profile + published corpus revision, not a
blanket product label. Same-author fixture tooling is **verificación cruzada
(mismo autor)**; S4 requires another person's verifier/review, not two languages
or two wrappers written by the same author. No such external S4 result is recorded.
It must also use another language with another cryptographic primitive backend:
the current OpenSSL CLI, Node/jose and cryptography/dnspython checks share the
OpenSSL family and establish no primitive-backend independence.

## 8. Security considerations and trust assumptions — Draft

- DNS ownership and APW key binding are inputs, not proof of honest conduct.
  The minimal Draft bootstrap trusts the configured validating resolver's AD bit
  over authenticated DoH, TLS and trusted local time; the resolver may lie or
  retain a valid older cache entry. A forwarded AD flag is not this observation.
- Offline DNSSEC requires a reviewed/audited third-party validation library,
  configured anchors and explicit support for the needed delegation algorithms.
  Fixture signature checks are not complete DNSSEC validation. DS-chain policy,
  NSEC/NSEC3 denial, wildcard processing and algorithm rollover remain outside
  the minimal Draft delivery; unsupported work cannot be promoted to success.
- A signed relay authenticates **bytes and its signer, not origin**: not the
  subject's socket IP, DNS pinning, live availability, truthful claims, complete
  worldwide evidence or freshness beyond proven dependencies. Original issuer
  signatures and separately authenticated roots remain mandatory.
- Enforce known-state rollback/equivocation rules, validity windows and evidence
  completeness. Replay of still-valid offline data does not establish latest
  state. Identity/proof validity never creates authorization or R-05 evidence.
- Acquisition bounds, SSRF protection, privacy/audience separation and grant
  enforcement are runtime obligations; this draft supplies no network adapter,
  validator, production engine or budget implementation.

## 9. Extensions and `typ` registry policy — Draft

Maintain a versioned project registry with identifier, layer, schema/semantics,
status and incompatible-version policy. It is **not an IANA registration**.
Do not reuse deployed identifiers for a new meaning. Unknown `typ`, profile or
rules version fails explicitly; no alias guessing or opportunistic downgrade.
Closed Draft envelopes reject extra members. Existing foreign signed artifacts
retain their own extension rules and exact bytes; unknown critical JOSE members
must fail under JOSE rules, never be silently ignored. New extensions require
documented hashing/signing semantics, positive/negative vectors and owner review.

| `typ` | Layer / meaning | Status |
|---|---|---|
| `ltp-proof-package` | Core evidence container | Draft 0.1 |
| `ltp-resolution-request` | Core service request | Draft 0.1 |
| `ltp-resolution-result` | Core candidate/service result, not verifier verdict | Draft 0.1 |
| `apw-key-set+jws` | APW signed key-window binding consumed by core | Draft 0.1 |
| `apw-index` | APW historical witness directory | Deployed; never the new LTP Index service |
| `apw-manifest+jws`, `apw-log+jws`, `apw-attestation+jws` | APW original signed artifacts | Existing; unchanged |

This is the registry seed for the S1/S3 scope, not an exhaustive registry of
every APW extension. SVRI Projection and HSVR acquire no new `typ` in this review.

## 10. Governance and acronym collision review — Draft

Governance is project-owned: changes go through a reviewed specification PR,
recorded rationale/errata, versioned assets and owner decision. Issuers/operators
choose trust policy; Portaless ownership grants no authority over other nodes.
CC BY 4.0 permits other implementations. No external standards-body recognition,
trademark clearance or repository rename is implied.

Initial collision check (2026-10-23), for the owner's naming decision:

| Acronym | Checked evidence | Finding / decision |
|---|---|---|
| LTP | [RFC 5326 title and abstract](https://www.rfc-editor.org/rfc/rfc5326.html) | Confirmed: **Licklider Transmission Protocol** already uses LTP. Unrelated protocol; the owner has selected **Local Trust Protocol** here. Qualify citations; LTP Stack denotes APW + LTP + SVRI + HSVR. The collision remains, without a uniqueness or endorsement claim. |
| SVRI | [Sexual Violence Research Initiative](https://www.svri.org/) | Confirmed public acronym collision. Spell out this project's projection name and version; owner decides naming before S6. |
| HSVR | [PubMed 42288468, abstract via Europe PMC](https://europepmc.org/article/MED/42288468), DOI `10.1016/j.anorl.2026.03.009` | Confirmed: **home sleep video recordings (HSVR)** is an existing expansion in clinical literature. Unrelated field; qualify the historical SVRI output name. Owner decides naming before S6. |

This records three confirmed acronym collisions, not trademark/name clearance.
No `typ`, formula, signed payload or repository name is changed by this review.
