# Becoming a Veracier — investigation and proposal

Status: **investigation + proposed scope. No UI is built yet.** ROADMAP Phase 15
is `GATED`; this document records what "a Veracier onboarding UI" (§15.2) would
actually require, so the build/ no-build decision is made with the facts in
front of it. Where this doc and the code disagree, the code governs.

## What a Veracier is

A Veracier is a `did:apw:<domain>` identity that **signs community attestations**
about other sites. Since APW v1.3 / ERRATA **E-13**, an attestation signed by a
`did:apw` is the only thing that scores on the `community` source — the old
anonymous vote was retired (`POST /trust/:siteId/vote` answers `410` with a
pointer to the signed route).

The moving parts already exist and are tested:

- **`POST /trust/:siteId/community-attestation`** — verifies the JWS against the
  emitter's **resolved** identity (TXT `_apw.<domain>` with `k` + `did.json`),
  rejects a duplicate `jti` (`409`), rate-limits one attestation per category
  per 24 h (`429`), records `emitterFirstSeenIat` for the scoring age floor.
- **`/trust/veracier/<domain>`** — the public page that shows a Veracier's
  emission history (shipped; ROADMAP Phase 8 item 3).
- **`signSiteJws(payload, key, typ)`** — the generic JCS + Ed25519 compact-JWS
  primitive. The reference signs its *own* attestations with the site key
  (`signSelfAttestation`); the same primitive works for a third party.

## The attestation a Veracier signs

Compact JWS (`typ: "apw-attestation+jws"`), payload in JCS, `kid` =
`did:apw:<emitter-domain>#key-<n>`:

```json
{
  "typ": "apw-attestation+jws",
  "iss": "did:apw:veracier.example",
  "sub": "did:apw:target.example",
  "src": "community",
  "cat": "perceived_trustworthiness",
  "val": 4,
  "iat": 1790000000,
  "jti": "<unique>"
}
```

- `cat` ∈ `perceived_trustworthiness`, `content_accuracy`, `spam_or_deceptive`,
  `responsiveness`.
- `val` is an integer 1–5 for `community` (boolean in the other sources).
- `iat` must be within ±300 s of the server clock; `jti` must be unique per
  emitter.

## What it takes to become one, today

| Step | Manual today? | Covered by |
| --- | --- | --- |
| 1. Own a `did:apw` identity on a domain you control (TXT `_apw.<domain>` + `/.well-known/did.json`) | **Yes** — DNS paste + hosting the document | `docs/protocol-apw/STARTER-KIT.md`; the wizard does it automatically **if you run a Portaless instance** |
| 2. Compose the claims above for a target site | Yes (hand-written JSON) | this document |
| 3. Sign it (JCS + Ed25519, `kid`) | **Yes — the gap** | `signSiteJws` exists as a primitive, but there is **no end-user signer** |
| 4. `POST` it and see yourself on `/trust/veracier/<domain>` | Yes (curl) | the endpoint + the public page |

So the missing piece is not the protocol; it is **step 3 plus a guided framing of
1–2**. That is what an "onboarding UI" would be.

## The decision that must be made first: how the private key is handled

This is the whole reason not to "just build the UI". A site owner's key already
lives server-side (`site_identity`) and the server signs for them. A **third-party
Veracier has no server here**, so the options are:

1. **CLI signer (recommended first).** A small command that takes the claims and
   a key file and prints the JWS. The private key never touches a web page; the
   only cost is that it is not "a UI".
2. **Client-side signing in the browser (WebCrypto Ed25519).** The person imports
   their JWK into a page, which signs locally and POSTs. The key never leaves the
   browser — but "paste your private key into a website" is itself the risk, and
   it is the exact thing this project tells people not to do. If built, it must
   be marked experimental and never described as safe.
3. **Only for Portaless sites (defer to the site's own signer).** If the Veracier
   *is* a Portaless instance, the server can sign and the "UI" is a panel form.
   This covers the common case inside the ecosystem and needs no key handling —
   but it does not onboard a Veracier who is not running Portaless.

**Recommendation**: ship (1) as the primitive, and treat (2)/(3) as follow-ups
gated on a real would-be Veracier. Building a browser key-import surface before
there is anyone to use it would add attack surface for a hypothetical user.

## Proposed minimal scope (when the decision is made)

- A `veracier-sign` CLI (or a documented snippet against `signSiteJws`) that
  emits the JWS from `{ iss, sub, cat, val }` + a key file.
- A `docs/veracier-onboarding.md` guide (this doc, promoted) that walks steps
  1–4 with the exact commands and caveats.
- Optionally a form in `/admin/witness-index` (or a new admin page) that signs
  **for the site itself** when the operator's site acts as the Veracier (option 3).

## Honest limits (why this is not urgent)

- With a **single operator and an invite-only Beta**, there is no population of
  would-be Veraciers yet; the UI's value is prospective.
- **Portable reputation is still `GATED`** (ROADMAP, the portability limit of
  Phase 8): a Veracier's history is read from the evaluated site's table, not
  fetched from the emitter's own chain. The emitting half (this doc) and the
  consuming half (portability) must both exist before "a Veracier means
  something" is fully true.
- Signing **does not grant any capability** and is not reversible by the target
  site; deprecating an attestation is a future question, not solved here.

## What this document is not

It is not a commitment to build the UI, and it does not pick option 2. It exists
so the next person can decide with the trade-offs written down instead of
rediscovering them.
