# Protocol APW — Normative Specification v1.3

**Author**: Gerardo Loyola
**Project**: Portaless
**Date**: October 2026
**License**: CC BY 4.0 (see [License and governance](#license-and-governance))
**Status**: the single normative document. Consolidates v1.0 (design), v1.1 (identity and history), v1.2 (section 6, today the Loyal Trust Protocol), and corrections E-1 through E-11 of [`ERRATA.md`](./ERRATA.md) (Spanish, with the historical archive), which are **integrated into the text here**. When this document and any earlier version disagree, v1.3 governs. **Published errata that are not yet consolidated into the text below and are in effect**: E-12 (informative, Index aggregator), E-13 (normative: `community` as an attestation source with a numeric `val`, and the definitions §6.7 required for distinct emitters, `min_weight` and minimum emitter history age), and E-14 (normative: the signed pages document `/.well-known/apw-pages.jws`, `typ apw-pages+jws`, and the consumer guards — per-hop fetch, streaming cap, private-range blocking, mandatory cache, sanitized remote render), and E-15 (normative: the publisher-signed plugin manifest, `typ apw-plugin-manifest+jws`, whose signature covers `requestedCapabilities`, and the install rule — install grants nothing, removed capabilities are pruned, expanded ones are never auto-granted, versions are immutable). Fixed test vectors live in [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md), in a file independent of the code: an implementation outside Portaless can verify compatibility without reading or running this repository.

> Spanish archival copy with the same normative content: [`APW-SPEC-v1.3_es.md`](./APW-SPEC-v1.3_es.md). On any discrepancy in numbers, formulas, or keywords, the English file governs.

**Normative keywords**: *must*, *must only*, *never* indicate requirement; *may* indicates option; *today* marks a temporary limitation of the reference implementation.

**Version history**

| Version | Date | Content |
|---|---|---|
| [v1.0](./APW-SPEC-v1.0.md) | September 2026 | Initial design, preserved without substantive changes as citable prior art (Spanish) |
| v1.1 | October 2026 | Public identity, signatures, per-issuer attestations, and chained history (sections 5.1–5.6) |
| v1.2 | October 2026 | Section 6 (mutual authentication and read governance; published then as "Loyola Trust Protocol", today the Loyal Trust Protocol) and dimension scoring (Annex A) |
| v1.2 + E-1..E-9 | October 2026 | Complete reference implementation of sections 5, 6 and Annex A, with the corrections in [`ERRATA.md`](./ERRATA.md) |
| **v1.3 (this)** | October 2026 | Normative consolidation: E-1 through E-9 integrated into the body; test vectors separated from the code. Subsequently E-10 (witnesses, section 5.7) and automatic `reader_conduct` emission (§6.4) were integrated |
| v1.3 + E-11..E-13 | October 2026 | E-11 (public W-dimension projection, §6.6 and Annex A) integrated into the body; **E-12 (informative) and E-13 (normative) are published in [`ERRATA.md`](./ERRATA.md) and in effect, not yet consolidated here** |

[`apw-spec.md`](./apw-spec.md) and [`APW-SPEC-v1.2.md`](./APW-SPEC-v1.2.md) are superseded by this document.

---

## License and governance

**License of the standard.** This document, [`ERRATA.md`](./ERRATA.md) and [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) are published under **CC BY 4.0**: copying, translating, reimplementing, and commercial use of this specification are permitted, with attribution to the author. The reference implementation (Portaless code in this repository) is **AGPL-3.0** (see [`LICENSE`](../../LICENSE) and [`docs/architecture/licensing-boundaries.md`](../architecture/licensing-boundaries.md)): the standard's license does not infect the code, nor the code's license the standard.

**Patent non-aggression pledge.** In addition to the CC BY 4.0 license above, contributors to this specification covenant not to assert any patent they own or control against any party for implementing, distributing, or using Protocol APW as described herein, provided that party does not assert patent claims against other implementers of Protocol APW. This pledge is a commitment not to sue — not a patent license grant — and binds only its covenantee. Precedent: AT Protocol pairs a permissive code license with a public patent non-aggression pledge; APW keeps CC BY 4.0 for the specification text (no license change) and adds this pledge beside it.

**What this license does not cover.** The CC BY 4.0 grant applies to this specification text only. The Portaless reference implementation is licensed separately under AGPL-3.0: implementing Protocol APW requires no license over that code, and grants none. No trademark, name, or conformance mark is granted: conformance may be declared without Portaless's permission (Neutrality below), but not under the "APW" name as an endorsement.

**Authorship and edition.** Author: Gerardo Loyola. The Portaless project edits and publishes versions of this document. Annex A adapts the Veranet Universal Scoring System, by the same author; that does not restrict reimplementing Annex A.

**Name.** Section 6 is called **Loyal Trust Protocol (LTP)**. Earlier versions of the document published it as "Loyola Trust Protocol": same specification, same LTP acronym. When citing, use the name the cited version was published under.

**Neutrality and conformance.** This document requires no registration, permission, certification, or trademark licensing to implement. Any project may implement Protocol APW, LTP, or any of their parts, cite them, and declare conformance without any relationship to Portaless. Declaring minimal conformance means: publishing the artifacts this document requires and passing the minimal vectors (V-01, V-03, V-05, V-06, V-08, V-09) citing their IDs. No text outside this document and `ERRATA.md` is normative (principle 5, section 2).

**Change process.**

1. *Errata* (`E-n` in [`ERRATA.md`](./ERRATA.md)): corrections, clarifications, and limitation closures. A published erratum is in effect even before it is integrated into the body of a version; the next consolidation integrates it and the newest version governs.
2. *Versions* (`v1.x`): normative changes with a date and a row in the history above. On disagreement between documents, the newest version governs.
3. *Proposals*: changes are discussed as issues or PRs in the Portaless repository before becoming normative. What is not in this document or in `ERRATA.md` is information, not requirement.

---

## 1. Thesis

Protocol APW reduces the operational responsibility of whoever publishes a site to the bare minimum — domain, DNS, and SSL — and uses DNS as the control plane for identity, version, and trust. The goal is **verifiable trust in a site without a central authority, readable by AI agents**, with a reputation history the site can carry with it, that any authorized reader can verify, and that the site itself governs.

## 2. Design principles

1. **The site is the unit of identity.** `did:apw:<domain>` identifies a site or an agent operator, who is also a domain. It does not identify people.
2. **DNS is the root of trust.** Whoever controls the domain's DNS controls the identity. Everything else (HTTPS, database) is a secondary channel that must match the DNS.
3. **Reputation is per-dimension and weighted by the evaluator.** No entity has a single number that defines it. Each dimension scores 1.0 to 7.0 and each attestation's weight depends on the issuer's reputation as an evaluator (Annex A).
4. **Portable means signed by the issuer.** A reputation datum only travels off-site when its issuer signs it with a published key. What is unsigned is local data.
5. **Portaless is not an authority.** Any implementation that follows this specification produces and verifies the same artifacts.
6. **Trust is bidirectional.** The reader also identifies itself and also has reputation. The site decides who may read its trust data (section 6).
7. **Fail-closed.** Any identity, signature, chain, or policy verification that cannot be completed is treated as a failure: it is rejected or `on_fail` applies. It never opens by default.

## 3. Scope and reference implementation

### 3.1 Base

| Piece | Code | What it does |
|---|---|---|
| DNS reading | `packages/apw-resolver/src/dns-txt/dns-txt.ts` | Reads `_apw.<domain>` via DNS-over-HTTPS (Cloudflare 1.1.1.1). Works identically on edge and Node. |
| Manifest | `packages/apw-resolver/src/manifest.ts` | Compact JSON payload. v1 without identity; v2 with `k`, `h` and `rg` (§5.1). `parseApwManifest()` never throws and accepts both versions. |
| Resolver | `packages/apw-resolver/src/index.ts` | `resolveApwManifest(domain)`: the first TXT that parses as a valid manifest. |
| Publishing | `packages/apw-resolver/src/dnslink/cli.mjs` and the `/admin` checklist (`functions/admin/api/apw-verification-status.js`) | Generate the exact TXT value, with a warning if it exceeds ~512 bytes. |
| SiteTrustScore | `packages/trust-layer/src/site-trust/site-trust-score.ts` | 4 sources (`self`, `agent`, `community`, `escrow_report`) with closed categories and absence semantics; `SiteTrustSnapshot` without averaging. |
| Per-source writes | `PUT /admin/site-trust/:siteId/self`, `POST /trust/:siteId/vote`, `POST /trust/:siteId/agent-verification`, `POST /trust/:siteId/escrow-report` | Admin session; anonymous with `ipHash` rate limiting; Web Bot Auth + `authorized_agents` allowlist; API key + `authorized_escrow_providers` allowlist. |
| Agent identity | `packages/trust-layer/src/webbotauth/` (draft-03, shared by middleware and SiteTrustScore) | Verifies who makes each request: this is the reader's identity in section 6. |
| Ledger | Trust Layer (`usage_ledger`) | Records verified accesses and policy violations per agent, plus the reader's candidate DID (`reader_did`). |

### 3.2 Sections 5 and 6

| Piece | Code | Requirements |
|---|---|---|
| `did:apw` identity with key history (`keyId` `#key-<n>`, fingerprint, `validFrom`/`validTo` windows) | `did-apw/generate.ts`, `site-identity-store.ts`, `key-id.ts`, `fingerprint.ts` | 5.1, 5.4 |
| `GET /.well-known/did.json` and TXT-vs-`did.json` verification | `functions/.well-known/did.json.js`, `resolveApwIdentity()` | 5.1 |
| Site JWS with JCS and extended manifest `GET /.well-known/apw-manifest.jws` | `did-apw/site-jws.ts`, `site-manifest.ts` | 5.2 |
| Verifiable attestations `agent`, `escrow_report`, `self` | `trust-layer/src/site-trust/attestation.ts`, `/trust/:siteId/*` endpoints | 5.3 |
| Signed chained history and `GET /.well-known/apw-log.json` | `did-apw/history-log.ts`, `history-resolver.ts`, `attestation-log-store.ts` | 5.4 |
| Attestation bundle `GET /.well-known/apw-attestations.json` | history with `att_jws` | 5.5 |
| Dimension scoring and R-05 calibration | `scoring/scoring.ts` | Annex A |
| Read policy, reader identity, and fail-closed enforcement | `scoring/read-policy-store.ts`, `reader-identity.ts`, `policy.ts`, `functions/trust/[siteId].js` | 6 |
| Reader reputation (`reader_conduct`) with completeness, and ledger-backed emission | `scoring/reader-attestations.ts`, `reader-conduct-emitter.ts`, `reader-conduct-config.ts`, `functions/admin/api/reader-conduct/emit.js` | 6.4 |

## 4. Gap history

| # | Original gap | Status | How it closed |
|---|---|---|---|
| B1 | The DID document is not public | Closed | `GET /.well-known/did.json` (5.1). |
| B2 | The published TXT does not include identity | Closed | v2 manifest with `k`, `h` and `rg` (5.1). |
| B3 | The site's key never signs anything | Closed | Site JWS, extended manifest, history entries and `self` (5.2, 5.3). |
| B4 | An agent's verification is not re-verifiable | Closed | Attestation signed with the agent's Web Bot Auth directory key (5.3). |
| B5 | Escrow reports are not verifiable by third parties | Closed | Attestation signed with the provider's registered public key (5.3). |
| B6 | The history can be edited without a trace | Closed | Chained history anchored with `h` in DNS (5.4) and witnesses (5.7). Does not detect the initial omission (5.7). |
| B7 | `community` has no voter identity | Open | Still outside the chain (5.3); requires voter identity (section 7). |
| B8 | Voting failed on self-host | Closed | Fixed when the specification was published. |
| B9 | Reputation is public-read and one-directional | Closed with limits | Read policy (§6.5) and reader reputation (§6.4). *Equivocation* and rewriting: witnesses (5.7). Origin omission: no detector (5.7). |

## 5. Identity and history (v1.1 + E-1 to E-5, E-9)

### 5.1 `did:apw` resolution (closes B1 and B2)

`did:apw:<domain>` resolves through **two channels that must match**:

1. **DNS (root of trust).** The manifest at `_apw.<domain>` adds the `k` field: fingerprint of the active public key. It occupies 43 characters and leaves headroom within the ~512 bytes.
2. **HTTPS (full document).** `GET https://<domain>/.well-known/did.json` returns the public `didDocument` (no private keys), in the same format as `did:web`.

**Computation of `k` (normative).** `k` is the **RFC 7638 JWK Thumbprint** with SHA-256, in unpadded base64url. It is computed only over the mandatory members of the key, in lexicographic order, with no whitespace. For Ed25519 (`kty: "OKP"`, RFC 8037) those members are `crv`, `kty` and `x`:

```
{"crv":"Ed25519","kty":"OKP","x":"<x>"}
```

The full JWK is not canonicalized: optional members (`key_ops`, `ext`, `alg`, `kid`) vary by implementation and would make two verifiers compute different fingerprints. It is the same computation Web Bot Auth uses for the `keyid`, so an agent's APW fingerprint matches its `keyid` (§6.3). Vectors: V-01 in [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md).

**Validity rule.** A resolver considers the identity valid only if the fingerprint of the `did.json` key equals the TXT's `k`. If they differ, the identity is invalid: the HTTPS channel cannot override DNS. Rotating the key requires updating the TXT; previous keys remain published with their validity windows (§5.4). If the manifest carries no `k`, the identity is not verifiable (`manifest_without_key`).

**Manifest v2.** The resolver accepts v1 and v2: a v1 manifest is still valid, but without verifiable identity. Fields `k` and `h` must be 43-character base64url strings and `rg` a boolean; in v1 they are ignored. The `rg` field is defined in §6.5.

```json
{"v":2,"siteId":"example.com","trustUrl":"/trust/example.com","contentKinds":["mixed"],"k":"<fingerprint>","h":"<head>","rg":true}
```

The manifest is serialized as compact JSON (no spaces) and optional fields are omitted rather than serialized as `null`.

### 5.2 Site artifact signing (closes B3)

Every artifact signed by the site is a **compact JWS** (RFC 7515) with `alg: "EdDSA"`, whose payload is JSON canonicalized with JCS (RFC 8785). The first artifact is the **extended manifest**, served at `/.well-known/apw-manifest.jws`.

**Header (normative).** `{ "alg": "EdDSA", "kid": "<keyId>", "typ": "<typ>" }`. The header is also serialized with JCS.

- `kid` is the `keyId` of the active key, `did:apw:<domain>#key-<n>` (E-3). It is not a fixed `#key-1`: after rotating, signing with `#key-1` would make the correct key impossible to find.
- The `kid` must belong to the signer's DID: a site must not sign with another domain's `keyId`.
- `typ` is the expected artifact type: `apw-manifest+jws` for the extended manifest, `apw-attestation+jws` for `self` attestations (§5.3).

**Payload (normative).** Serialized with **JCS (RFC 8785)** before signing. I-JSON values only: the issuer rejects `undefined`, `NaN`, `Infinity`, `bigint`, functions, and non-flat objects rather than omitting or coercing them. JCS is implemented with a package listed in RFC 8785 as a reference (in Portaless: `canonicalize`).

**Verifying a site artifact (normative).**

- `alg` = `EdDSA`, `typ` and `kid` exactly as expected.
- Valid signature with that `kid`'s public key (from the DID document or the log's `keys`, §5.4).
- The received payload must be **in JCS form**: if `JCS(JSON.parse(payload))` does not reproduce the signed bytes, it is rejected (`not_canonical`). This is stricter than attestation verification from a foreign issuer (§5.3), where the verifier does not canonicalize, because here the issuer is always an APW implementation and JCS is mandatory.

**Extended manifest**: `GET /.well-known/apw-manifest.jws`.

- `typ`: `apw-manifest+jws`. Response `application/jose`, public (no Web Bot Auth), short cache.
- Payload: the same fields as the `_apw.<domain>` TXT (`v`, `siteId`, `trustUrl`, `contentKinds`, `k`, `h`, and `rg` when present) plus `did` (the site's DID) and `iat` (Unix seconds). TXT and manifest come from the same function, so they cannot diverge.
- A resolver accepts the manifest if: the signature verifies with the `kid`'s key; that key's RFC 7638 fingerprint is the TXT's `k`; and `siteId`, `trustUrl`, `contentKinds` and `k` match the TXT.
- The manifest's `h` may be **newer** than the TXT's: the manifest is signed with the current history head and the TXT is updated by hand. Equality is not required; the resolver verifies that the TXT's `h` appears in the chain and that the chain reaches the manifest's `h` (intermediate entries remain unanchored, §5.4).
- Without identity it responds `404 site_identity_not_found`, same as `did.json`.

### 5.3 Issuer-signed attestations (closes B4 and B5)

An attestation is a JWS issued by whoever produces the data, never by the evaluated site itself:

```json
{
  "typ": "apw-attestation+jws",
  "iss": "<issuer identity>",
  "sub": "did:apw:<domain>",
  "src": "agent | escrow_report | self | reader_conduct",   // + community (ERRATA E-13)
  "cat": "<category or transaction_outcome>",
  "val": true,
  "iat": 1790000000,
  "jti": "<unique identifier>"
}
```

**Delivery.** The compact JWS goes in `body.attestation`, alongside the usual flat fields. The flat fields must match the signed payload; if they do not, the response is `400 attestation_mismatch`. The signature governs: a different flat body is never accepted.

| Source | Endpoint | Verifying key | `iss` | Required match |
|---|---|---|---|---|
| `agent` | `POST /trust/:siteId/agent-verification` | The agent's Web Bot Auth directory key; header `kid` = the HTTP signature's `keyid` | Origin of `Signature-Agent` | `cat` = `category`, `val` = `verified` |
| `escrow_report` | `POST /trust/:siteId/escrow-report` | The provider's registered `public_key_jwk` | `escrowProvider` | `cat` = `transactionOutcome`, `val` = `true` |
| `self` | `PUT /admin/site-trust/:siteId/self` | The `kid`'s key (§5.2) | The site's own `did:apw:<domain>` | `cat` = declared category, `val` = declared value |

**Validations** (in this order):

1. Header: `alg` = `EdDSA`; if `typ` is present it must be `apw-attestation+jws`.
2. Ed25519 key (`kty: "OKP"`, `crv: "Ed25519"`). ML-DSA keys are not accepted for attestations.
3. Valid signature over the received bytes. The verifier does not canonicalize the payload.
4. Payload: `typ` = `apw-attestation+jws`; `sub` = `did:apw:<siteId>`; `src` = the endpoint's source; `iss` per the table (https URLs compare by origin); `cat` a string of 1 to 64 characters; `val` a boolean; `jti` of 1 to 128 visible ASCII characters (`[\x21-\x7e]`).
5. `iat` within ±300 seconds of the verifier's clock. *(Does not apply when reading attestations from a third party's published history: there `skipIatWindow` governs, §5.5.)*
6. `jti` unique per issuer. A repeated `jti` responds `409 duplicate_attestation`.

When `kid` is required (for example in `self`), it must match the expected value exactly. Failures use the codes of [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) V-06.

**Prior authentication unchanged.** `agent` still requires Web Bot Auth and the `authorized_agents` allowlist; `escrow_report` still requires the API key. A provider without `public_key_jwk` remains authorized but cannot report (`403 provider_without_public_key`).

**Persistence.** The JWS is stored in full in the existing SiteTrustScore row (`attestation_jws`, `attestation_jti`), with no parallel store. If `sub` is the site's own DID, the JWS is also logged into the chained history (§5.4). If the history fails, the report is still stored and the response indicates `logged: false`. Rows predating the signed schema keep an empty `attestation_jws`: they are not verifiable by third parties.

**Per source**:

- **`agent`**: `iss` is the agent's `Signature-Agent` origin and the signature uses **the same Ed25519 key the agent already publishes in its Web Bot Auth directory**.
- **`escrow_report`**: `iss` is the `provider_id`; `authorized_escrow_providers` stores the provider's public key. The API key still authenticates the endpoint; the signature is the exportable proof.
- **`self`**: the site signs with its own key (§5.2), `iss` = `sub` = `did:apw:<domain>`, random `jti`, header `typ` = `apw-attestation+jws` and `kid` = active `keyId`. It is verified with the same validation routine, using the `kid`'s key. The JWS is stored in the existing `site_trust_self_evaluations` row (`attestation_jws`, `attestation_jti`); the row is an upsert per category and stores the **current** attestation, while previous ones remain in the chained history. If the site has no identity, the declaration is stored without a JWS and the response reports `signed: false`: the signature is additive and does not block an admin who has not completed the wizard, but those rows are not verifiable by third parties. `self` remains the weakest signal (fixed weight 0.25, A.4.2); the signature makes it attributable, not more trustworthy.
- **`community`**: remains **outside the chain** (B7). It is still shown as local data, marked as unverifiable.
- **`reader_conduct`**: see §6.4.

### 5.4 Chained history (closes B6)

Each accepted attestation is appended to a site log. Each entry is a JWS signed by the site with payload `{ seq, prev, att, ts }`, where `prev` is the hash of the previous entry, `att` the hash of the issuer's JWS, and `ts` the moment of logging.

**Normative definitions:**

- **Hash**: `base64url(SHA-256(jws))` unpadded, computed over the compact JWS as-is (43 characters). Applies to `prev`, `att` and `h`.
- **First entry**: `seq: 1` and `prev: null`.
- **Entry JWS**: compact, header `{ "alg": "EdDSA", "kid": "<kid>", "typ": "apw-log+jws" }`, where `kid` is the `keyId` of the key used, `did:apw:<domain>#key-<n>`. Entries created before the DID `keyId` definition use the key's RFC 7638 fingerprint as `kid`; both formats are accepted when verifying.
- **`ts`**: ISO 8601 in UTC. It must not be earlier than the previous entry's `ts` (`ts_regression`).
- **Uniqueness**: the same attestation cannot be logged twice (`duplicate_attestation`).

**Chain verification** (in this order):

- Each entry resolves by its header `kid` against the site's public key list (`unknown_key` if absent).
- The `keyId` must have the format `did:apw:<domain>#key-<n>` with `<n>` a positive integer without leading zeros, and the DID must be the domain being verified (`key_kid_mismatch`).
- Each key's published fingerprint must be the thumbprint of its public key; two keys must not share an identifier, nor may a `keyId` match another key's fingerprint (`key_kid_mismatch`).
- Valid signature of each entry (`bad_signature`), consecutive `seq` (`seq_gap`), `prev` equal to the previous entry's hash (`prev_mismatch`), `ts` within the signing key's window and not earlier than the previous entry's (`ts_outside_key_window`, `ts_regression`).
- The TXT's `k` must be the log's active key (`validTo: null`) (`active_key_mismatch`). This way DNS anchors the key list.
- The TXT's `h` must be the hash of some entry in the chain. If it does not appear, an already-published entry was deleted or altered (`head_mismatch`).

**Publishing**: `GET /.well-known/apw-log.json`, paginated with `?from=<seq>&limit=<n>` (maximum 500). Returns `did`, `head` (`{ seq, hash }`), `length`, `keys` and `entries` (`{ seq, jws }`) and `next`. Each `keys` element carries `keyId`, `keySequence`, `fingerprint`, the `kid` alias (= `fingerprint`), `validFrom`, `validTo` and `publicKeyJwk` **with public members only** (`crv`, `kty`, `x`). Without identity it responds 404.

**Key rotation**: rotating does not invalidate the history. Each site key has two identifiers and publishes both:

| Field | Value | Use |
|---|---|---|
| `keyId` | `did:apw:<domain>#key-<n>` | `kid` of the header of every JWS the site signs |
| `keySequence` | `<n>`, integer from 1, unique per site | Grows with each rotation; never reused |
| `fingerprint` | RFC 7638 fingerprint (§5.1) | Compared against the TXT's `k`. Also published as `kid`, for compatibility |

The site keeps every public key it used with its `validFrom` / `validTo` window and publishes it in `keys`. An entry verifies against the key its `kid` indicates, provided its `ts` falls within that key's window (endpoints included). A retired key's private key is deleted on rotation. Existing keys receive `#key-1`, `#key-2`… by registration date; the log's `kid` column stores the signing key's fingerprint.

**DNS anchoring**: entries after `h` are valid but not yet anchored: `h` changes with each attestation and the TXT is updated by hand (computing the value is automatic: admin panel and `dnslink/cli.mjs --anchor --domain`, both via `buildSiteManifest`). A verifier must report how many entries remain unanchored. Witnesses (§5.7) anchor the head over time **without touching DNS**: between two anchored observations of a witness, the subject's chain cannot have changed retroactively.

**Attestation bundle (E-9)**: the signed log entry still contains only the `att` hash; each attestation's full JWS is stored separately (`att_jws`) and published at `GET /.well-known/apw-attestations.json` (`{ did, entries: [{ seq, att, jws }], next }`).

**Limitations that remain**:

- It does not detect omissions (§5.7: witnesses bound rewriting, *equivocation* and backdating, not the initial omission).
- `ts` is declared by the site itself. With a compromised key, entries with old dates could be signed within that key's window; anchoring `h` in DNS and witnesses (§5.7) bound that risk.

### 5.5 Export and verification

- The chain is published at `GET /.well-known/apw-log.json` and each issuer's JWSs at `GET /.well-known/apw-attestations.json`. *This replaces the originally planned `GET /trust/:siteId/attestations`.*
- `resolveApwHistory(domain)` resolves the TXT, verifies `k` against the log's active key, walks the chain and checks the `h` anchoring. It returns a result and never throws, with `anchoredSeq` and `unanchoredEntries`.
- Verifying each attestation against its issuer's key is the job of whoever consumes the bundle. For `reader_conduct`, that burden is on `loadReaderConduct()` (§6.4): each JWS must have its `att` hash in the chain, and each chain `att` must have its JWS (completeness).

### 5.6 Test vectors

The specification ships with fixed vectors (keys, payloads, JWSs, hashes, rejection rules, and Annex A scores) so another implementation can verify compatibility without depending on Portaless's code. All current vectors are in [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md), in a file independent of the code.

### 5.7 Witnesses (E-10)

A **witness** is any site with a `did:apw` identity that observes ANOTHER site's chained history and publishes a signed statement with the head it saw. It closes the *equivocation* and retroactive-history-rewriting gap (§5.4) without a central authority: the statement's credible date is not declared by the witness in its payload, but by the chained entry in the WITNESS's OWN history, anchored by the witness's `h` in DNS.

**Statement** (compact JWS; header `typ: "apw-witness+jws"`; payload in JCS, like every site-signed artifact):

```json
{
  "typ": "apw-witness+jws",
  "iss": "did:apw:<witness>",
  "sub": "did:apw:<subject>",
  "seq": 3,
  "head": "<43-character hash or null>",
  "ts": "2026-10-09T12:00:00.000Z",
  "jti": "wt-<base64url(SHA-256(iss|sub|seq|head))>"
}
```

- `seq` and `head` describe the **last entry** of the subject's observed chain: `seq` is its length and `head` its hash. `seq: 0` with `head: null` means an observed empty chain. `seq > 0` requires `head`; `seq = 0` forbids `head` (*fail-closed*: any other combination is an invalid statement).
- `jti` is deterministic: repeating the observation of the same head produces the same `jti` and generates no new statement.
- `ts` is the declared instant of the observation. **It is not the credible date**: the credible date is the `ts` of the entry in the WITNESS's OWN history where the statement was logged (§5.4), because that entry is chained and its hash is anchored by the witness's `h`.
- Signature: the witness's key (§5.2). The statement is logged into the witness's history like any attestation: chained, published in its `apw-attestations.json` (E-9), and protected by its DNS anchoring.

**Publishing**: `GET /.well-known/apw-witnesses.json`, paginated like `apw-attestations.json` (`?from`, `?limit`), with only the history's `apw-witness+jws` statements: `{ did, length, entries: [{ seq, att, jws, witness: { sub, seq, head, ts, jti } }], next }`.

**Recording (reference implementation)**: `POST /admin/api/witness/record` with `{ domain }` (admin role) resolves the subject's chain via `resolveApwHistory()` (§5.5) and logs the statement into its own history. The deterministic `jti` makes repeating the same head idempotent (`duplicate_attestation` on the chain's unique index).

**Verification (normative)** — evaluating a subject with witnesses:

1. Verify the chain of each WITNESS (§5.4), via `resolveApwHistory()`.
2. Each statement must be **logged in that verified chain**: `att = base64url(SHA-256(jws))` must match an entry, and the JWS must verify against the witness's key (§5.2): correct `typ`, valid signature, `jti` equal to the recomputed one, `iss` equal to the witness's DID and `sub` equal to the subject's DID. An observation that is not in a verified chain **does not count**.
3. Cross each anchored observation `(witnessDid, seq, head, anchoredTs)`, where `anchoredTs` is the `ts` of its entry in the witness's chain, against the subject's CURRENT chain. Normative findings:
   - **`head_mismatch`**: the current chain's entry at `seq` has a hash different from `head` (or the chain is shorter than `seq`). The subject rewrote or truncated an already-observed head.
   - **`equivocation`**: two anchored observations with the same `seq` and different `head`: two witnesses saw incompatible chains at the same position.
   - **`backdated_entry`**: a subject entry with `seq` GREATER than the observed `seq` declares a `ts` earlier than the witness's `anchoredTs` minus 300 s. That entry did not exist when the witness observed: its `ts` is false.
4. **Fail-closed**: on any finding, the subject's chain is not trustworthy for reputation. One finding suffices; findings are not averaged.

**What it does NOT cover**: omission from the origin (the site never logs an attestation that harms it). Detecting it requires crossing the history of that attestation's ISSUER with the reader's — an emitter-vs-receiver comparison, outside the scope of §5.7. Witnesses bound rewriting, truncation, *equivocation*, and backdating.

**Limits**:

- A malicious witness can invent observations; that is why only observations anchored in the WITNESS's own verified chain count, and the evaluator decides which witnesses to listen to (not normative here: Portaless Index is the first aggregator).
- Two observations of the same subject hours apart prove its head did not change between those moments, even without updating the TXT.
- Updating the TXT remains manual (no DNS provider exposes a standardized API); **computing** the value is automatic (`dnslink/cli.mjs --anchor --domain <d>` and the panel checklist, both via `buildSiteManifest`).

**Aggregator (Portaless Index, informative)**: an evaluator needs to listen to several witnesses. Portaless implements the first aggregator as a node feature: `POST /admin/api/index/sync` (admin role) pulls from a configured set of witnesses (pull of `/.well-known/apw-witnesses.json`, paginated), applies exactly the four §5.7 verifiers to each statement (witness chain verified, `att` anchored in that chain, signature against its key, deterministic `jti`; plus expected `iss`/`sub` and no self-witness), stores the latest anchored observation per (subject, witness, seq) — a smaller anchor never overwrites a larger one — and evaluates against the subject's live chain. **Weighting** is static: one weight per witness (default 1.0, editable by whoever syncs); the directory's `consensus` is the head with the most weight sum at the last observed `seq`. The result is cached and published as a plain document at `/.well-known/apw-index.json` (`{ typ: "apw-index", iss, generatedAt, subjects[] }`), with no signature of its own because every entry is re-verifiable against the subject's and its witnesses' chains. **Out of scope for this version**: A.4.4-style weight calibration (a witness gains weight by agreeing with consensus), push/gossip synchronization between index nodes (each node only pulls its own witnesses), and manifest/SiteTrustScore aggregation from other instances (section 7).

## 6. Reputation-based Read Governance — Loyal Trust Protocol (v1.2 + E-8, E-9)

### 6.1 The problem (closes B9)

The web is asymmetric: crawlers identify, profile, and score sites, but sites cannot identify or score those who read them. With v1.1 a site's reputation history is public: anyone can build a database of "the best sites" without permission or reciprocity.

### 6.2 Concept

The **Loyal Trust Protocol** (Mutual Trust Reputation) uses APW identity in both directions:

1. The site defines read policies over its trust resources and, later, content.
2. The reader (AI agent, index, another site) authenticates with Web Bot Auth and its `Signature-Agent` origin resolves to `did:apw:<reader-domain>`.
3. The site verifies the reader's APW history (§5.5), computes its dimensions (Annex A) and evaluates the policy. Only if it holds does it serve the resource; otherwise it responds per `on_fail`.

The result is **Trust Enclaves**: sets of sites and readers that only expose data to each other when both sides prove identity and reputation. Typical cases: indexes that only read sites which accept them, independent media networks that share history only among verified journalists, and sites that refuse to be profiled by anonymous crawlers.

### 6.3 Reader identity

- The reader identifies with Web Bot Auth (draft-03), implemented in `webbotauth/verify.ts`.
- Its `Signature-Agent` origin (for example `https://index.example`) maps to `did:apw:index.example`, which resolves the same way as a site's (§5.1).
- The key that signs the Web Bot Auth request must have the same RFC 7638 fingerprint as `k` in the reader's TXT, and its history must verify. This way agent identity and APW identity are unified: one key pair per domain.
- **Non-active keys (normative).** After a rotation (§5.2), the reader may also sign with the retired key, but only within its effective window `[validFrom, validTo + grace]`, with `validTo` = the rotation instant and a 10-minute rollover grace **on the verifier's side**. The grace extends nothing published: rotation closes the key and deletes its private half at rotation; it exists so agents that still had the old key in flight are not cut off mid-flight. Besides falling within the window, the retired key must satisfy all of the following (all fail-closed):
  - appear in the reader's history `keys`, with that history already verified against the TXT's `k` and `h`;
  - have signed at least one entry of that chain: its fingerprint or its `keyId` appears as the `kid` of an anchored entry. This way a compromise of the reader's hosting **alone** is not enough to authorize a new key, because adding a key to the `keys` array changes no entry and not `h`;
  - not be `k` (the active key proceeds on its own path) and have a parseable window with `validTo` different from null.

  If any condition fails, or if the verdict arrives after the window has closed, the reader is `apw_unresolvable` with reason `key_not_bound_to_apw`. Acceptance is cached like any verification, but the TTL clamps to the window's effective close: the cache never stretches a retired key beyond `validTo + grace`.
- `reader_conduct` emission (§6.4) still requires `operatorKeyId` = `k`: a reader in mid-rollover reads, but does not accumulate reputation until signing with the active key.
- Reader states and responses: no valid signature → `401`; valid signature without APW → `on_fail`; APW that cannot be verified (or `reader_conduct` that does not verify, §6.4) → `on_fail` with reason `apw_unresolvable`; APW verified → thresholds are evaluated.
- A reader without APW identity can authenticate via Web Bot Auth, but has no reputation: any policy requiring reputation rejects it.

### 6.4 Reader reputation: `reader_conduct` attestations

For a reader to have reputation, someone must emit it. The **`reader_conduct`** source has a site emit an attestation about a reader after interacting with it:

```json
{
  "typ": "apw-attestation+jws",
  "iss": "did:apw:<emitting-site>",
  "sub": "did:apw:<reader>",
  "src": "reader_conduct",
  "cat": "respected_policy | rate_respected | paid_as_agreed | redistribution | policy_violation",
  "val": true,
  "iat": 1790000000,
  "jti": "<unique identifier>"
}
```

- The emitting site signs it with its key (§5.2). It is added to the issuer's history (a record of what was emitted) and delivered to the reader, which incorporates it into its own history.
- `policy_violation` and `redistribution` with `val: true` are real negative signals, with the same semantics as `agent.verified: false`. A reader cannot delete them from its history without breaking the chain, nor hide them without breaking completeness; if it does not accept them, the issuer keeps them and may expose them to other sites of its enclave.

**Loading and verification (normative).** The evaluator verifies the reader's chain (§5.4), fetches the attestation bundle, and requires:

- each JWS to have its `att` hash in the chain (cannot be invented or altered);
- completeness: each chain `att` to have its JWS (an already-logged `policy_violation` cannot be hidden);
- each `reader_conduct` whose `sub` equals the reader's DID, and whose issuer is not the reader itself, to verify against the issuer's published keys: the active key must be the issuer's TXT `k`, the header `kid` must resolve to that key, and the `iat` must fall within the key's window. The ±300 s window over `iat` does not apply when reading from history (`skipIatWindow`): the chain's signed `ts` proves when it was logged.
- Entries with `ts` before `legacyCutoff` (2026-10-04T00:00:00.000Z) may lack a JWS; per `legacyEntriesWithoutJws` (`ignore` by default) they are ignored or break completeness. After the cutoff, an entry without a JWS always breaks completeness.
- **Fail-closed**: if a `reader_conduct` cannot be verified, the reader is `apw_unresolvable` with reason `reader_conduct_*`. A reader cannot discard its negatives by claiming they do not verify.

**Emission.** The Trust Layer ledger is the source. The site records the reader's candidate DID in the ledger (`did:apw:<host of Signature-Agent>`, unverified). `POST /admin/api/reader-conduct/emit` (admin + step-up) emits per period (month by default; there is no `year` period — a year range aggregates the weekly buckets, §7.1) only when `operatorKeyId` is the reader's TXT `k`. It signs with the active key, uses a deterministic `jti` (issuer, reader, period, category), and logs each emission into its own history: the issuer publishes what it emitted. Repeating a period's emission does not duplicate: already-logged `jti`s are reported as `already_emitted`. Today `respected_policy` and `policy_violation` are emitted; the other three await a datum the origin does not yet have:

- `rate_respected` (R-02): there is no rate to respect. The content policy only declares `access`, `price_usd` and `unit`: there is no per-reader request limit, nor its enforcement, nor a rate-rejection counter in the ledger.
- `paid_as_agreed` (R-03): the origin does not know whether the crawler paid. With the current settlement provider (Cloudflare Pay Per Crawl, in-band pricing) the origin answers `200` with `crawler-price` and collection settles outside it: that is why the ledger always records `charged: false` and its charging columns never move. Emitting this category from there would invent the datum; it would need a settlement that reports the outcome to the origin.
- `redistribution` (R-04): not observable by the origin (section 8): the protocol can record the conduct if someone detects it, but cannot prevent or see it. It requires witnesses or a third party's denunciation, not the access ledger.

**Automatic emission (E-10)**: the Trust Layer can fire the same emission when recording a verified access with a candidate `readerDid`, with no manual step. The normative requirements are the same: only what the ledger says about the agent in that period is emitted, with the same deterministic `jti` and the same `k` check on the reader; repetition remains `already_emitted`. An explicit opt-out (`APW_AUTO_EMIT_CONDUCT=false`) disables it; the step-up admin endpoint remains available for backfilling old periods.

**What completeness proves and does not prove**: it proves the reader did not hide or alter attestations **it already logged** in an anchored chain. It does not prove it logged all the attestations it received, nor that it shows the same chain to every visitor.

### 6.5 Read policies

A policy is a **set of predicates over dimensions** (Annex A), evaluated against the reader's history:

```json
{
  "resource": "/trust/*",
  "action": "read",
  "require": {
    "identity": "apw_verified",
    "R-01": { "min": 5.0, "min_weight": 2.0 },
    "R-05": { "min": 5.0, "min_weight": 2.0 }
  },
  "on_fail": "403"
}
```

**Storage (normative).** The policy lives in its own typed table, `site_trust_read_policies`: `enabled`, `require_apw_identity` (fixed at 1), `min_r01`, `min_r01_weight`, `min_r05`, `min_r05_weight`, `public_overrides`, `on_fail` (`401`, `402` or `403`). Defaults are those of A.6. Without a row, or with `enabled = 0`, reading is public. `public_overrides` stores the owner's explicit A.6 override: an array of **governed dimensions** (never a public one, which already is, nor an unknown one) that become public in the projection; it changes neither the policy nor access, and a corrupt value in the row is ignored (the owner simply loses the override). The Permissions Center is reserved for **per-reader exceptions**: a `trust:read-governance-bypass` grant (subject `reader`, whose `id` is the reader's `did:apw:`) lets them read even without meeting the thresholds. The bypass **does not skip identity**: it requires an `apw_verified` reader (§6.3), does not skip `require_apw_identity`, and does not validate a corrupt policy (still `403 policy_invalid`); a reader whose identity could not be verified lands on `on_fail` grant or not. The manifest only announces `rg: true`; the full policy is never published: publishing it would tell an attacker exactly what to fabricate.

**Governable resources**: `GET /trust/:siteId` (and its `/trust/*` equivalents). In a later version, any content path, combined with the Trust Layer's `allow`/`charge`/`block` policy.

- `on_fail: "402"` integrates with pay-per-crawl settlement: the owner may allow compensating missing trust with payment.
- A predicate with an unknown dimension or invalid value invalidates the whole policy and the response is `403 policy_invalid`.
- R-05 starts disabled in the configuration (`policyDimensions`) and is not a simple toggle: a subject's R-05 is the calibration of the attestations **it** emitted (A.4.4), and `loadReaderConduct` only loads what the reader **received** (drops `iss` equal to its own DID). A reader that does not emit stays at R-05 = 4.0 with weight 0, so with `min_r05_weight = 2.0` the policy would reject **every** reader, not just the bad ones: the effective default policy requires only R-01. The table already supports `min_r05`; enabling it requires no migration, but only makes sense with the two missing data flows (section 7). The blocker is anchored in `tests/unit/apw-reader-conduct-config.test.ts`.

### 6.6 What remains public

- The TXT (`k`, `h`, `rg`), `did.json`, the extended manifest, the log, and the attestation bundle are always public: without them nobody could verify anything.
- `h` is a public commitment over the history: it reveals that it exists and that it changed, not its content. An authorized reader checks that what it received matches `h`.
- Public-level dimensions (A.6) and, for **all** dimensions, the score, count, and weight sum (aggregates).

**Projection in the response (normative).** `GET /trust/:siteId` computes the site's W dimensions from its snapshot (A.2 and A.4) and always publishes them in a `projection` object with `{ dimensions, aggregates, governed }`:

- With an active policy and a **denied** reader, `projection` goes inside `public`: `dimensions` contains **only** the public set (W-01, W-04, W-06, W-07, W-09) plus the governed dimensions the owner made public with its explicit override (A.6, stored in `public_overrides`), `aggregates` carries score, count and weight sum of **all** the site's dimensions, and `governed` is `"withheld"`. The public level is never hidden: a stricter policy does not remove W-01 from the response.
- With an **allowed** reader (grant or met thresholds), or with public reading (no policy), `projection` goes in the body with **all** dimensions and `governed` is `"granted"`.
- A dimension with no attestations appears in neither object: without data it is not `4.0`, it is *no data*. `aggregates` also invents no rows for W-08.
- Categories A.2 does not map (`community.perceived_trustworthiness`) do not score; their rows remain public as raw data in the snapshot. The projection is metadata: if its calculation fails, the response is emitted without it and the access decision does not change.

### 6.7 Cold start and fake identities

- **Cold start**: a new reader begins with all dimensions at 4.0 and evaluator weight 0.25 (A.4.2). It gains reputation by reading resources from sites with lax or public policies. That is why a site's default is to publish the full public level.
- **Fake identities (Sybil)**: an attacker can register many domains and self-issue attestations between them. Required defenses:
  - **Evaluator weighting** (A.4.2): a new domain weighs 0.25 and only gains weight if its evaluations agree with the consensus of already-weighted emitters.
  - Count only **distinct** emitters and require a minimum weight sum in each predicate (`min_weight`). A reader's attestations about itself do not count toward its R-05.
  - Minimum age of the emitter's history (dimension W-07).

> **ERRATA E-13 (in effect, not yet consolidated above)**: `community` is an attestation source whose `val` is an integer 1..5; a distinct emitter is a distinct `did:apw`, so one operator with several domains counts as several emitters; the community predicate's `min_weight` is 2.0 applied per (subject, category); and minimum emitter history age is a 7-day threshold below which an emitter's attestation is recorded but weighs 0 and does not count toward `min_weight`.
  - Weighting `escrow_report` (regulated third parties) above `reader_conduct` when the policy requires it.
- No defense is perfect: an attacker with enough old, well-calibrated domains can build reputation. The cost of doing so is the defense, as in any trust network.

### 6.8 Implementation on top of what exists

| Piece | Reuses | Adds |
|---|---|---|
| Reader authentication | `webbotauth/verify.ts` (draft-03) | `Signature-Agent` → `did:apw` mapping and key check against `k` (`reader-identity.ts`) |
| Reader reputation | `resolveApwHistory()` (§5.5), with TTL cache | `reader_conduct` with completeness (`reader-attestations.ts`), ledger-backed emission (`reader-conduct-emitter.ts`), and R-dimension computation |
| Policies | Typed table `site_trust_read_policies` | Predicate evaluator (`policy.ts`) and A.6 projection of the W dimensions (`site-dimensions.ts`) |
| Per-reader exceptions | The Permissions Center's `PermissionStore` (`packages/permissions`) | `trust:read-governance-bypass` capability over the reader's DID (subject `reader`) |
| Enforcement | `functions/_middleware.js` and `functions/trust/[siteId].js` | 401, 403 or 402 responses with the public projection; never opens by default |
| 402 | `billing/pay-per-crawl/` | `on_fail: "402"` |

### 6.9 Limits

- Governance protects what the site serves as governed. Open content (public HTML, `llms.txt`) remains readable unless it is also governed.
- An authorized reader can copy and redistribute what it reads. The protocol can record that conduct (`redistribution`) if detected; it cannot prevent it.
- Verifying reputation on every request adds latency: it is cached per host and fingerprint (5 minutes on success, 60 seconds on failure), and for a retired key the success TTL clamps to its window's close (§6.3). If the policy or the reader's history cannot be resolved, `on_fail` or `503` applies; it never opens by default.
- Completeness proves the reader did not hide attestations **already logged**. It does not prove it logged all it received; witnesses (§5.7) bound it showing different chains to different observers, but not the initial omission.

## 7. Future (outside the current implementation)

- **Portaless Index**: witness network and discovery. The **local aggregator** already exists (§5.7, "Aggregator"): a directory of verified observations per subject, static per-witness weighting, published at `/.well-known/apw-index.json`. Missing is the network: A.4.4-style weight calibration (a witness gains weight by agreeing with consensus), gossip synchronization between index nodes (today each node only pulls its own witnesses), and manifest/SiteTrustScore discovery across multiple instances (indexability format, third-party query permission, and a provenance layer). Index is also the first natural reader of the enclaves.
- **Portable `community`** (B7): requires voter identity with resistance to fake identities.
- **R-05 in policies**: not a config toggle, two data flows are missing (§6.5). (1) A flow where the reader **emits** attestations over subjects: today only anonymous community voting by IP, no DID, and `loadReaderConduct` does not even load what the reader emits (it drops `iss` equal to its own DID). (2) A **corpus** of other emitters on the same (subject, dimension) for A.4.4's leave-one-out consensus: indexes or witnesses. While both are missing, a reader's R-05 is 4.0 with weight 0 and the threshold would reject everyone.
- **History-age signal in W-07**: A.4.1 does not define how to carry an age to the 1..7 scale, so W-07 scores today only with `agent.content_freshness` (§6.6).
- **Intra-dimension signals of A.2** (60/40, 50/50…): A.4.3 scores with the emitter's weight (A.4.2); the signal's weight within the dimension is still not in the formula.
- **New conduct signals** (§6.4): each awaits its own datum. `rate_respected` requires a rate in the content policy and a rejection counter in the ledger; `paid_as_agreed` requires a settlement that tells the origin whether the crawler paid (the current one settles out-of-band and the origin only sees `charged: false`); `redistribution` requires witnesses or denunciation, because the origin cannot observe it (section 8).
- **Content governance**: extend §6.5 to any path, not just `/trust/*`.
- **ML-DSA (FIPS 204)** in site and emitter APW signatures. ML-DSA verification already exists for the Web Bot Auth identity of the `agent` source, but attestations require Ed25519 (§5.3).
- **Portaless Cloud Images**: the same attestation format applied to images.

### 7.1 Ranking filters (order must be recomputable)

The exhibit of a network (ROADMAP Phase 9) is that a third party can **recompute the ordering** from the same signed attestations — not merely see it. That requires the filters to be normative here, not in any implementation. The reference implementation is `packages/apw-resolver/src/scoring/ranking.ts` (AGPL-3.0); the definition is this section plus vector **V-16** (CC BY 4.0), so a closed product can implement it without copying the code.

**Query.** Every query declares a `filter`, an evaluation instant `asOf` (epoch seconds) and, for `top`, a `windowSeconds`; `confidence` declares a `seq` instead of a window. There is no implicit "now": without `asOf` the order is not recomputable.

**One time key.** Each entry is anchored to a verified observation; `observedAt` is the `ts` of the witness's chained entry that contains the statement (§5.7), the credible date. The window (`top`) and the order (`recents`, `new`, `old`, `history`) use **that same key**; never the emitter's `iat`, which is declared by whoever signs and is therefore backdatable within its key's window (§8). An entry with no resolved observation is excluded from **every** filter — explicitly, with no default. `asOf` bounds the considered set for every filter: an observation after `asOf` did not exist at that instant.

**Order.** Scores are rounded to 6 decimals and compared with tolerance `1e-9` (the same rule as A.4.5 and V-08: `((6.7-1)/6)^2` is not exact in IEEE-754). Ties break by the full tuple **(score desc, Σweight desc, count desc, subject asc)** — the subject identifier is the **last** criterion, never the only one, because in a young network `top` is a field of near-ties and "tie-break by DID" alone would be alphabetical order.

**`top`.** Prior-weighted Bayesian score (A.4.3) over the entries in the window, computed only if the surviving weight sum is at least `min_weight` (default `COMMUNITY_MIN_WEIGHT_DEFAULT = 2.0`, §6.7). A subject below the threshold is **absent**; it is never filled with the neutral prior (`NEUTRAL = 4.0`). In a young network this means `top` is nearly empty: that is the datum, not a defect.

**`confidence`.** The witness consensus over the declared `seq`: the head with the greatest weight among observations at that `seq` (the same rule the Index uses, §5.7). It is not the reader's own mean. Observations at other `seq` are ignored.

**`recents` / `new` / `old` / `history`.** `recents` orders by the last `observedAt` (descending); `new` by the first `observedAt` (descending); `old` by the first (ascending); `history` by the count of entries (descending, then last `observedAt` descending).

**Input hash.** The result carries `inputHash` — the `sha256` of the admissible set (entries with a resolved observation), canonically serialized. A node cannot omit attestations without the hash changing.

**Year ranges.** `EmissionPeriod` covers `month | week | day`; there is no `year` (§6.4). A year-range query aggregates the weekly buckets rather than adding a fourth period; a `year` period would be a v1.4 change with its own vector.

## 8. General limits

- Identity proves control of the DNS, not truthfulness of the content.
- A site can omit attestations that harm it until witnesses exist.
- If the site's key is compromised, the attacker can sign new entries until it is rotated and the TXT updated.
- `ts` is declared by whoever signs the entry: with a compromised key, entries can be backdated within that key's window.
- `community` remains inflatable until voter identity exists.
- APW shares primitives with federated protocols (DID identifiers, signed records, verifiable history), but does not yet define a node-to-node synchronization layer; that layer belongs to Portaless Index.

---

## Annex A — Dimension scoring

Adapted from the Veranet Universal Scoring System (Gerardo Loyola) to the domain of websites and AI agents. Signed attestations (§5.3) are the raw material; the dimensions are how it is read. The four sources do not disappear: they are the provenance of each attestation. Implementation: `packages/apw-resolver/src/scoring/scoring.ts`.

### A.1 Principles

1. **Separation by dimension.** Each dimension is an independent score.
2. **Universal 1.0 to 7.0 scale.** 4.0 is neutral: the value of an entity with no history.
3. **Weighting by the evaluator.** An attestation's weight depends on the issuer's R-05 dimension.
4. **Full transparency.** Anyone with access can recompute every score from the signed attestations and these formulas.
5. **Indestructibility.** A score is never erased; it only changes with new attestations. The chained history (§5.4) guarantees it.
6. **Domains only.** The model rates sites, indexes, and agent operators. It does not rate people.

### A.2 Site dimensions (W)

| ID | Dimension | Signals (weight) | Sources |
|---|---|---|---|
| W-01 | Technical security | HTTPS and headers (60%), absence of traffic anomalies (40%) | `agent`: `https_and_headers`, `bot_traffic_anomalies` |
| W-02 | Content truthfulness | Perceived accuracy (60%), published corrections (40%, new) | `community`: `content_accuracy`; `agent` (future) |
| W-03 | Transparency | Contact and responsible parties (40%), published terms (30%), complaint responsiveness (30%) | `self`: `contact_transparency`, `terms_of_service`; `community`: `responsiveness` |
| W-04 | Privacy and data | Privacy policy and GDPR (50%), verified data practices (50%) | `self`: `privacy_policy`, `gdpr_compliance`, `data_practices`; `agent` (future: trackers) |
| W-05 | Commercial compliance | Transactions completed (60%), disputes resolved (25%), declared payment security (15%) | `escrow_report`; `self`: `payment_security` |
| W-06 | Agent readability | Structured data (40%), machine-readable policies (40%), `llms.txt` and markdown (20%) | `agent`: `structured_data_quality`, `machine_readable_policies` |
| W-07 | Continuity | Content freshness (50%), APW history age (50%) | `agent`: `content_freshness`; first history entry |
| W-08 | Provenance | Declared human/AI origin (50%), match with observation (50%) | `self` (new category); `agent`/`community` (future) |
| W-09 | Coherence | Divergence between declared (`self`) and third-party verified (`agent`, `escrow_report`) | Derived (A.5) |
| W-10 | Integrity | Absence of spam or deception (100%) | `community`: `spam_or_deceptive` |

Categories without a dimension: `community.perceived_trustworthiness` feeds no dimension (not in the table); its votes remain public as a raw snapshot row. W-08 awaits the new `self` categories (declared human/AI origin) and has no categories yet.

### A.3 Reader dimensions (R)

| ID | Dimension | Signals | Veranet equivalent |
|---|---|---|---|
| R-01 | Policy respect | `respected_policy` vs `policy_violation` | S-13 Ethical |
| R-02 | Rate respect | `rate_respected` | S-11 Respect |
| R-03 | Payment compliance | `paid_as_agreed` | S-04 Buyer, S-15 Financial |
| R-04 | Discretion | not redistributing governed data (`redistribution`) | S-18 Others' privacy |
| R-05 | Fairness as an evaluator | calibration of its attestations against weighted consensus (A.4.3) | S-14 Justice |

A domain can hold both W and R dimensions at once: a site also reads and evaluates others.

### A.4 Calculation

#### A.4.1 Value of an attestation

Each attestation contributes a value `v` from 1.0 to 7.0 to a dimension. Normative mapping:

| Input | Scale | Value |
|---|---|---|
| `true` | boolean | 7.0 |
| `false` | boolean | 1.0 |
| 1 | `community` | 1.0 |
| 2 | `community` | 2.5 |
| 3 | `community` | 4.0 |
| 4 | `community` | 5.5 |
| 5 | `community` | 7.0 |
| `completed_as_promised` | `escrow_report` | 7.0 |
| `refunded_no_delivery` | `escrow_report` | 2.5 |
| `disputed` | `escrow_report` | 1.0 |

`community` votes (1 to 5) are linearly rescaled to 1.0 to 7.0; a vote outside 1..5 is an error. `escrow_report` outcomes use the native scale (completed 7.0, refunded without delivery 2.5, disputed 1.0): in that JWS `val` is always `true` and what scores is the `cat` (§5.3). For `reader_conduct`: `respected_policy`/`rate_respected`/`paid_as_agreed` with `val: true` contribute 7.0 to their R dimension; `policy_violation` with `val: true` contributes 1.0 to R-01; `redistribution` with `val: true` contributes 1.0 to R-04.

#### A.4.2 Emitter weight

```
w = ((clamp(J, 1, 7) - 1) / 6) ^ 2
```

`J` is the issuer's R-05 dimension. A new issuer has J = 4.0 and w = 0.25. An issuer with J = 6.7 has w = 0.9025: its opinion weighs 3.61× more. An issuer with J = 1.0 has w = 0. The `self` attestation has fixed weight 0.25 and never feeds its own R-05.

#### A.4.3 Dimension score

Weighted Bayesian average with a neutral prior:

```
S = (P * 4.0 + sum(w_i * v_i)) / (P + sum(w_i))
```

with `P = 3`. With few attestations the score stays near 4.0: a single review does not push anyone to an extreme.

#### A.4.4 R-05 calibration

`J = max(1, 7 - 1.5 x d)`, where `d` is the mean absolute deviation of the issuer's attestations on the 1 to 7 scale. An issuer with no comparable attestations stays at J = 4.0.

- Each attestation's deviation is measured against the **weighted average of the other emitters** on the same subject and dimension, **without the prior P** (leave-one-out). P is still used for the published score (A.4.3), not for calibration.
- J is computed by fixed point: all start at J = 4.0 and iterate (8 rounds in this version), because each emitter's weight depends on the others' J.
- Does not count toward one's own R-05: `self` attestations, nor an issuer's attestations about itself. If the other emitters carry no weight, the attestation is not compared.
- An issuer who attacks systematically loses weight and its subsequent attacks count for less.

The factor 1.5, the round count, and P are default values of this version, adjustable with new test vectors (V-09 and V-10 in [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md)).

#### A.4.5 Worked example (computed with the formulas above)

- Site A has **6.0950** in W-10, with 10 attestations of 7.0 from emitters with J = 6.0 (w = 25/36 = 0.6944). An emitter with J = 4.0 attacks it with a 1.0: A drops to **5.9700** (−2.05%).
- Site B has 4.0000 in W-10, with 10 attestations from emitters with J = 5.0 (w = 4/9 = 0.4444). An emitter with J = 6.7 says it deserves a 3.0: B drops to **3.8919**. With a 1.0, it drops to **3.6756** (−8.11%).
- Per point of deviation, the J = 6.7 emitter's opinion moves the score 3.61× more than the J = 4.0 emitter's.
- With no attestations, the score is the neutral **4.0000**.

#### A.4.6 Confidence

Each dimension is published with its score, the attestation count, and the weight sum. A 6.5 with weight sum 0.5 does not mean the same as a 6.5 with weight sum 40.

### A.5 Meta-indicators

| Indicator | Calculation | What it reveals |
|---|---|---|
| Coherence Index (W-09) | Mean difference between `self` declarations and third-party verification in the same categories | A site that claims GDPR compliance while agents find trackers |
| Stability Index | Historical variance of the dimensions | Whether the entity is predictable or erratic |
| Indicative Confidence Index | Weighted average of the dimensions | An indicative figure; never used alone in policies |

### A.6 What is public and what is governed

Criterion: what any crawler can verify on its own gains no privacy by being hidden; what comes from relationships (votes, transactions, conduct) does.

| Level | Dimensions | Who sees it |
|---|---|---|
| **Public (always)** | W-01, W-04, W-06, W-07, W-09, and for every dimension: score, count and weight sum | Anyone |
| **Governed (default)** | W-02, W-03, W-05, W-08, W-10, all R dimensions, and individual attestations with their comments | Readers with verified APW identity that meet the site's policy |

Default policy for the governed level: verified APW identity, R-01 >= 5.0 and R-05 >= 5.0, each with weight sum >= 2.0, `on_fail: 403`. The owner may harden it or make any governed datum public (explicit override), but cannot hide the public level: a site that hides its technical security gains no privacy, it loses verifiability. While R-05 remains disabled in the configuration (§6.5), the effective default policy requires only R-01 with the same thresholds.

---

## Normative references

| Standard | Use in APW |
|---|---|
| RFC 7515 | Compact JWS |
| RFC 7638 | JWK Thumbprint (`k`, `fingerprint`) |
| RFC 8037 | OKP Ed25519 keys |
| RFC 8785 | JCS: canonicalization of site payloads |
| RFC 9421 | HTTP request signing (Web Bot Auth) |
| did:web | Format of the public `didDocument` |
| draft-03 Web Bot Auth | Reader identity and the `agent` source |
| FIPS 204 (ML-DSA) | Post-quantum future (`key_algorithm` column) |
