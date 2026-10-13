# Public well-known endpoints

Every Portaless deployment with an APW identity publishes these endpoints under `/.well-known/`. They require **no authentication** — they are designed to be fetched by anyone; trust comes from cryptographic verification (see the [integrator recipe](./README.md#verifying-a-site-end-to-end-the-60-second-recipe)).

All endpoints respond `404` (with a JSON error body) when the site has no registered APW identity.

Pagination on log-like endpoints: `?from=<seq>&limit=<n>` with `limit` maximum 500. `next` is the next `seq` to continue with, or `null` when exhausted.

---

## `GET /.well-known/did.json`

The site's public DID document (`did:apw`), same shape as `did:web`. Spec §5.1.

- Response: `application/json` — a DID document whose `verificationMethod[0].publicKeyJwk` contains exactly `crv`, `kty`, `x` (public members only, **never** `d`).
- Verification: the RFC 7638 thumbprint of that key must equal the `k` published in the DNS TXT `_apw.<domain>` (vectors V-01). If not, the identity is invalid — DNS wins.

## `GET /.well-known/apw-manifest.jws`

The signed extended manifest (compact JWS). Spec §5.2.

- Response: `application/jose` — a compact JWS: `header.payload.signature`.
- Header: `{ "alg": "EdDSA", "kid": "did:apw:<domain>#key-<n>", "typ": "apw-manifest+jws" }`.
- Payload (JCS-canonicalized): the TXT manifest fields (`v`, `siteId`, `trustUrl`, `contentKinds`, `k`, `h`, `rg` when present) plus `did` and `iat`.
- Verification (vectors V-07): valid EdDSA signature with the `kid` key; the key's RFC 7638 fingerprint == TXT `k`; `siteId`/`trustUrl`/`contentKinds`/`k` match the TXT; payload bytes are in strict JCS form.

## `GET /.well-known/apw-log.json`

The site's chained attestation history — the core of APW verifiability. Spec §5.4.

```json
{
  "did": "did:apw:example.com",
  "head": { "seq": 12, "hash": "<43-char base64url>" },
  "length": 12,
  "keys": [
    {
      "keyId": "did:apw:example.com#key-1",
      "keySequence": 1,
      "fingerprint": "<RFC 7638 thumbprint>",
      "kid": "<same as fingerprint>",
      "validFrom": "2026-09-01T00:00:00.000Z",
      "validTo": null,
      "publicKeyJwk": { "crv": "Ed25519", "kty": "OKP", "x": "<x>" }
    }
  ],
  "entries": [ { "seq": 1, "jws": "<compact JWS typ apw-log+jws>" } ],
  "next": null
}
```

- Each entry JWS payload is `{ seq, prev, att, ts }`: `prev` = hash of the previous entry, `att` = hash of the issuer's attestation JWS, `ts` = ISO 8601 UTC logging time.
- Hash everywhere: `base64url(SHA-256(<bytes>))` unpadded (43 chars, vectors V-05).
- Verification (vectors V-05): entry signatures against `keys`, consecutive `seq`, `prev` chain, `ts` within each key's window and non-decreasing, TXT `k` == active key, TXT `h` ∈ chain hashes.

## `GET /.well-known/apw-attestations.json`

The full issuer JWSs referenced by the chain's `att` hashes (the chain entries themselves carry only the hash). Spec §5.4 (E-9).

```json
{
  "did": "did:apw:example.com",
  "entries": [ { "seq": 1, "att": "<43-char hash>", "jws": "<compact JWS typ apw-attestation+jws>" } ],
  "next": null
}
```

- Cross-check with the log: every entry ↔ its JWS both ways (completeness — a logged `policy_violation` cannot be hidden; see spec §6.4 and vectors V-12).
- Each attestation JWS verifies against its **issuer's** key (not the site's): `agent` via the agent's Web Bot Auth directory, `escrow_report` via the provider's registered `public_key_jwk`, `self`/`reader_conduct` via the signing site's key history (vectors V-06).

## `GET /.well-known/apw-witnesses.json`

Statements this site publishes as a **witness** of other sites' chains. Spec §5.7 (E-10).

```json
{
  "did": "did:apw:witness.example",
  "length": 3,
  "entries": [
    {
      "seq": 40,
      "att": "<hash of the statement jws>",
      "jws": "<compact JWS typ apw-witness+jws>",
      "witness": { "sub": "did:apw:subject.example", "seq": 3, "head": "<43-char hash>", "ts": "2026-10-09T12:00:00.000Z", "jti": "wt-<43 chars>" }
    }
  ],
  "next": null
}
```

- To evaluate a subject with witnesses: verify each witness's own chain first, confirm the statement is logged in it (`att` ∈ chain), then cross `(seq, head)` against the subject's current chain. Findings: `head_mismatch`, `equivocation`, `backdated_entry` (300 s margin). Full rules and a 7-case evaluation table: spec §5.7 and vectors V-13.
- The statement's credible date is the `ts` of the entry in the **witness's** chained history, not the statement's own `ts`.

## `GET /.well-known/apw-index.json`

The **Portaless Index** directory: pre-computed, re-verifiable observations of subjects by this node's configured witnesses. Spec §5.7 ("Aggregator", informative).

```json
{
  "typ": "apw-index",
  "iss": "did:apw:index.example",
  "generatedAt": "2026-10-11T13:00:00.000Z",
  "subjects": [
    {
      "subjectDid": "did:apw:subject.example",
      "domain": "subject.example",
      "status": "consistent",
      "length": 14,
      "head": "<43-char hash>",
      "observations": [
        { "witnessDid": "did:apw:witness.example", "seq": 3, "head": "<43-char hash>", "anchoredTs": "2026-10-09T12:00:00.000Z", "jti": "wt-…", "weight": 1.3, "baseWeight": 1, "calibrationFactor": 1.3 }
      ],
      "findings": [],
      "consensus": { "seq": 3, "head": "<43-char hash>", "weight": 1.3 },
      "witnessesUsed": ["did:apw:witness.example"],
      "witnessesSkipped": [],
      "syncedAt": "2026-10-11T13:00:00.000Z"
    }
  ]
}
```

- `status`: `consistent` | `head_mismatch` | `equivocation` | `backdated_entry` | `subject_chain_unverified` | `no_observations`.
- `consensus`: the head with the most **effective** per-witness weight sum at the last observed `seq`. Effective weight = `baseWeight × calibrationFactor`: the base is the operator's static weight (default 1.0); the factor comes from A.4.4-style **calibration** — a witness that agrees with the consensus gains factor (~1.9 ceiling), one that disagrees loses it (~0.1 floor), witnesses with no observation at the consensus `seq` are not counted. Both components are published per observation so any reader can recompute.
- **The document is plain and unsigned on purpose**: every entry is re-verifiable against the subject's and its witnesses' raw chains. Treat it as a cache/hint, not as authority. Other Portaless Index nodes may use this document as **discovery** (subject + `witnessesUsed`); they re-verify everything locally and never import observations unverified (spec §7; inter-node sync shipped in the reference implementation, Phase 5). Still out of scope: manifest/SiteTrustScore aggregation across instances.
- Response headers: `access-control-allow-origin: *`, `cache-control: max-age=60`.

## `GET /.well-known/portaless-usage-log.json`

The site's public traceability ledger (what its Trust Layer recorded about agent accesses and policy violations).

- Query: optional `?period=YYYY-MM`.
- Public, no session guard — same transparency criterion as the content policy below.

## Static: `/.well-known/portaless-content-policy.json`

The site's content policy (access/price rules per content kind), served as a static file from `public/.well-known/` when present. Used by crawlers to discover pay-per-crawl terms.

---

## `GET /trust/:siteId`

A site's trust data — the endpoint every reader of reputation hits. Subject to the site's **read policy** when one is active (spec §6.5).

- **No policy (or public reading)**: returns the full `SiteTrustScore` projection, including all dimensions with `governed: "granted"`.
- **Active policy**: requires Web Bot Auth (draft-03) whose `Signature-Agent` origin resolves to a verifying `did:apw` (spec §6.3). Responses:
  - no/invalid signature → `401`;
  - valid signature, no APW identity → `on_fail` (default `403`) with reason `apw_identity_required`;
  - APW unresolvable → `on_fail` with reason `apw_unresolvable`;
  - verified but thresholds unmet → `on_fail` (default `403`) with the **public projection only**: `public.projection.dimensions` = public set (W-01, W-04, W-06, W-07, W-09) + any owner override (`public_overrides`), `public.projection.aggregates` = score/count/weight-sum of all dimensions, `governed: "withheld"`;
  - verified and thresholds met (or an explicit `trust:read-governance-bypass` grant) → all dimensions, `governed: "granted"`.
- Dimension semantics and scoring: Annex A of the spec; vectors V-08 to V-11.
- The full policy is **never** published (the manifest only announces `rg: true`); publishing it would tell an attacker exactly what to fabricate.

## `GET /trust/atproto/:handle`

The public join for an AT Protocol handle — identity per the official AT spec plus Portaless reputation when a site claims the handle (the optional APW ↔ AT bridge; design and honest limits in [`docs/architecture/identity-atproto.md`](../architecture/identity-atproto.md)).

- **Auth**: none. `access-control-allow-origin: *`, `cache-control: public, max-age=300` on success (`max-age=60` on errors).
- **Path**: `:handle` with or without the leading `@` (case-insensitive).
- **200** body:
  - `identity`: `{ did, didMethod: "plc"|"web", resolvedBy: "txt"|"https", claimedHandles, hasSigningKey, pds }`;
  - `apw`: `null`, or `{ siteId, confidence: "also_known_as"|"self"|"subdomain", did, trust }` where `trust` is `null` or the site's **public-only** view (`{ siteId, counts, projection, trustUrl }` — local store when this deployment *is* the site, else `https://<siteId>/trust/<siteId>`);
  - `user`: `null`, `{ status: "ok", subjectDid: "did:apw:<handle>", dimensions }` when `reader_conduct` history exists, or `{ status: "no_data", reason }` otherwise (honest absence, never an invented zero);
  - `limitations`: always-present structural caveats (third-party resolution, suffix-only discovery, host-scoped R, best-effort remote trust).
- **Errors**: `400 invalid_handle | reserved_tld` (syntax or reserved TLD — `.test`, `.onion`, ...), `404` when the handle or DID does not resolve (or the handle↔DID link does not close), `502` when the upstream resolver is down (`upstream_error`, `did_unreachable`, ...). The endpoint never answers `500`: join failures (remote trust unreadable, no conduct history) degrade inside the 200 instead.
- **Caching**: the join is cached per handle for 5 min (success) / 1 min (failure) in process.

## `POST /trust/images/verify`

Standalone verification of a **Cloud Image** sidecar against the APW registry — "C2PA without a central authority": anyone with the sidecar (and optionally the image) verifies it without asking anyone's permission (design and honest limits in [`docs/architecture/cloud-images.md`](../architecture/cloud-images.md)).

- **Auth**: none. `access-control-allow-origin: *`, `cache-control: no-store`.
- **Body**: `{ sidecar: { payload, jws }, imageBase64?: string }` — the Cloud Image v1 sidecar (as embedded in the PNG's private `pAPW` chunk, or shipped as a separate `.json`).
- **200** body (the verification **never throws**; failures come back as structured data):
  - `valid`: final verdict;
  - `reason`: root cause when invalid (`invalid_sidecar`, `header_invalid`, `kid_did_mismatch`, `site_keys_unresolvable`, `key_not_found`, `bad_signature`, `payload_mismatch`, `invalid_typ`, `content_hash_mismatch`);
  - `signature`: `{ valid, reason? }`, `contentHash`: `{ status: "match" | "mismatch" | "not_checked" }` (checked only when `imageBase64` is sent; the hash is over the sidecar-free bytes — an image with the `pAPW` chunk already embedded is accepted, the chunk is stripped before hashing);
  - `keySource`: `"history"` (chained APW registry, retired keys included — images signed months ago stay verifiable across key rotations), `"did.json"` (site without a verified history yet), or `"none"`;
  - `payload`: the canonical payload when valid.
- **Errors**: `400 invalid_json_body | invalid_sidecar` only — everything else is a 200 with `valid: false`.

## `GET /images/:imageId`

Public bytes of a registered Cloud Image, with the signed sidecar already embedded in the private `pAPW` PNG chunk — the image travels with its own metadata.

- **Auth**: none. `content-type: image/png`, CORS `*`.
- **Caching**: `cache-control: public, max-age=31536000, immutable` with `ETag = "<contentHash>"` (a registered image never changes; a new version is a new `imageId`). `304` on `If-None-Match`.
- **404** `image_not_found` for unknown ids.

## `GET /trust/images/:imageId`

Local verification of a registered image against **this site's own key registry** (for registry-independent verification of an arbitrary sidecar use `POST /trust/images/verify` above).

- **Auth**: none. `cache-control: public, max-age=60`, CORS `*`.
- **200** body: `image` (metadata incl. `trust` and the full `sidecar`) + `verification`:
  - `signature`: Ed25519 against `site_identity` `listKeys` — retired keys included, so the record stays valid across key rotations;
  - `embedded`: `{ status: "match" | "mismatch" | "missing" }` — the `pAPW` chunk extracted from the served bytes vs the stored sidecar;
  - `contentHash`: `sha256(stripPng(bytes))` vs the registered hash;
  - `valid`: all three checks pass; `keySource: "local_store"`.
- **404** `image_not_found` for unknown ids.
