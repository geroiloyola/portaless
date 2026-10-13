# APW Starter Kit — implement the protocol in your stack

This guide is for someone who has **never seen Portaless's code** and wants
to implement Protocol APW in any language. It is language-agnostic: every
step is pseudocode plus a test vector you can check without running our
repository. The normative document is
[`APW-SPEC-v1.3.md`](./APW-SPEC-v1.3.md) (CC BY 4.0); when this guide and
the spec disagree, **the spec governs**. Acceptance criteria live in
[`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md), a file independent of any
code.

**What you are building**: a *verifier* — given a domain name, decide
whether the site at that domain controls a stable cryptographic identity
(`did:apw`), whether its published key history is intact, and whether a
piece of signed content (manifest, attestation) is authentic. No database,
no server, no Portaless install. The only primitives you need:

- SHA-256
- base64url (unpadded)
- Ed25519 verify
- JSON with deterministic serialization (for JWS)
- DNS-over-HTTPS (HTTPS GET, JSON API — see below)

The TypeScript reference implementation is the `.` export of
`@portaless/apw-resolver` (`src/standalone.ts`), but you do not need it:
the vectors below are enough to know you got it right.

**Minimal conformance** (spec, Neutrality section) = passing vectors
**V-01, V-03, V-05, V-06, V-08, V-09** and publishing the artifacts the
spec requires. Declaring conformance needs no permission.

---

## Step 1 — Fingerprint `k` (RFC 7638 thumbprint) — vector V-01

Every APW key is identified by the RFC 7638 thumbprint of its Ed25519
JWK, computed over **only the mandatory members, lexicographic order,
no whitespace**:

```
function fingerprint(jwk):            # jwk = {kty:"OKP", crv:"Ed25519", x:"<base64url>"}
  if jwk.kty != "OKP" or jwk.crv != "Ed25519": error unsupported_key_type
  if jwk.x missing:                    error missing_jwk_member:x
  canonical = '{"crv":"Ed25519","kty":"OKP","x":"' + jwk.x + '"}'
  return base64url(sha256(canonical)) # 43 chars, unpadded
```

Check against V-01:

| `x` | expected `k` |
|---|---|
| `11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo` | `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k` |
| `JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs` | `poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U` |

Extra members (`d`, `kid`, …) are ignored — the thumbprint depends only on
`crv`, `kty`, `x`.

## Step 2 — Key identifiers — vector V-02 (structure, not scored)

```
keyId(did, n)  = did + "#key-" + n        # n >= 1, integer
parse(keyId)   = {did, sequence}          # null on: #key-0, #key-01, missing fragment, non-integer
```

Each key in a `did.json` carries `kid` = its fingerprint (alias) and a
`keyId` = `#key-<sequence>`; the sequence increases on rotation, only the
latest key has `validTo: null`.

## Step 3 — Resolve the identity: DNS TXT — vector V-03

The root of trust is a **DNS TXT record** on `_apw.<domain>` (DNS control,
not just hosting). Fetch it via DNS-over-HTTPS:

```
GET https://cloudflare-dns.com/dns-query?name=_apw.<domain>&type=TXT
Accept: application/dns-json        # any DoH JSON API works
```

Parse the TXT value as compact JSON:

```
v: 1 or 2 (integer)          — else missing_or_invalid_version
siteId: non-empty string
trustUrl: must start with "/trust/"  — else missing_or_invalid_trustUrl
contentKinds: non-empty subset of {text, image, product, link, mixed}
k (v2): 43-char base64url  — else invalid_key_fingerprint
h (v2): 43-char base64url  — else invalid_history_head
rg (v2): boolean (optional) — else invalid_read_governance
```

A v1 manifest (no `k`) is valid but has **no verifiable identity** — a
verifier that needs cryptographic identity should treat it as
`manifest_without_key` and stop. Example valid v2 record:

```
{"v":2,"siteId":"example.com","trustUrl":"/trust/example.com","contentKinds":["mixed"],"k":"kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k","h":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
```

## Step 4 — Fetch `did.json` and match `k` — vector V-03 (cross-resolution)

```
GET https://<domain>/.well-known/did.json
```

Verify, in order (each failure has the reason the vectors expect):

1. Document is a `did:apw:<domain>` document (`did_mismatch` if another domain).
2. Some key's fingerprint (Step 1) equals the manifest's `k` (`key_mismatch` otherwise).
3. The key is currently valid (`validTo == null` or in the future).

You now have the site's active public key. Everything below verifies
*against that key* — that is the whole point of the chain.

## Step 5 — Verify the chained history (JWS + hash chain) — vector V-05

The site publishes its attestation log at
`/.well-known/apw-log.json`: an ordered list of entries, each entry a JWS
whose protected header carries `typ`, `kid` (the signing key's keyId) and
`seq`; `entryHash(n) = base64url(sha256(jws_bytes(n)))`; entry `n>1`
embeds `prev = entryHash(n-1)` in its payload. The head `h` in the TXT
record must equal `entryHash(last)`.

```
function verifyChain(entries, keys, expected_head):
  prev = genesis_hash                   # all-zero 43-char, see spec 5.4
  for i, entry in enumerate(entries, start=1):
    if entry.payload.seq != i:          return chain_broken
    if entry.payload.prev != prev:      return chain_broken
    key = findByKeyId(keys, entry.header.kid)     # keyId or fingerprint
    if key is none:                     return unknown_key
    if not ed25519_verify(key.jwk.x, signinput(entry), entry.signature):
      return bad_signature
    prev = base64url(sha256(entry.jws_bytes))
  if expected_head is set and prev != expected_head:
    return head_mismatch
  return verified
```

`signinput(jws)` is the standard JWS signing input:
`base64url(protected) + "." + base64url(payload)`. Vector V-05 walks a
3-entry chain including a broken-hash rejection.

## Step 6 — Verify a site-signed JWS (manifest / self) — vectors V-04, V-06, V-07

Two JWS formats appear in the wild: a bare JSON header (the log above)
and a compact `apw-manifest+jws` / `apw-attestation+jws` served at
`/.well-known/apw-manifest.jws` and used inside attestations. The payload
must be **canonically serialized** before signing: JCS (RFC 8785,
vector V-04 — most languages have a JCS library; if you roll your own,
V-04 is the acceptance test).

Foreign-issuer attestation (V-06): issuer `did:apw:<other-domain>` signs
over the subject site with `kid` in the header; you must resolve the
**issuer's** keys the same way (Steps 1–4 on the issuer domain) and
require `kid` to select the key. `iss == sub` ("self" attestation) uses
the same routine with the site's own key.

## Step 7 — Scoring primitives — vectors V-08, V-09

If you only verify identity and signatures, stop at Step 6 — that is a
useful verifier. If you also score trust (Annex A of the spec), the
primitive aggregations and the Bayesian examples A and B are fixed by
vectors V-08 and V-09; implement them last, against the spec text — they
are arithmetic, not crypto.

---

## What you publish to claim conformance

1. `_apw.<domain>` TXT record (v2 with `k` and `h`).
2. `/.well-known/did.json` whose key matches `k`.
3. The log at `/.well-known/apw-log.json` whose head matches `h`.
4. A statement citing the vectors you pass (V-01, V-03, V-05, V-06,
   V-08, V-09) and the spec version (v1.3).

No registration, no permission, no trademark license (spec, Neutrality
section). Conformance may be declared freely — but not under the "APW"
name *as endorsement*; "implements Protocol APW v1.3, vectors V-01…" is
the honest phrasing.

## Optional: interoperable identity (did:web Path A) — not yet fully specified

Protocol v1.3 describes an optional path: publishing an additional
`/.well-known/did.json` in **did:web** format whose `service` entry points
at the same DNS-anchored log would let existing did:web resolvers read
the identity unchanged. **Honest limit**: the subject-mapping rule this
path requires — stating that a `did:web:<domain>` publishing the same key
and declaring the `did:apw:<domain>` log via `service` is recognized as
the same subject for verification — is **not yet specified**; without it,
"compatible" would be half-true (see `ROADMAP.md` Phase 4, item 5). Until
that erratum is published, an implementer must treat `did:web:<domain>`
and `did:apw:<domain>` as **distinct subjects**, even when they share a
key. The DNS TXT root of trust (Steps 3–6 above) is unaffected and fully
specified today.

## Where to ask questions / report spec bugs

The protocol lives in this repository's `docs/protocol-apw/` tree; spec
issues are best reported as issues on the Portaless repository citing the
section number. Implementations are independent — there is no central
registry to join.
