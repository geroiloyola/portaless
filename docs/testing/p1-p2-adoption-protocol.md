# P1/P2 external adoption protocol — Portaless official Beta

**Status: executable test protocol. Not a release, gate change or authorization.**
Baseline: `main` after PR #113 (post-audit login hardening), 2026-10-28.
License: CC BY 4.0 for this protocol.

This is the minimum real-world test for the existing official Beta exit criterion:

> a person outside the project, without the author's direct help, installs
> Portaless, publishes a site with APW identity, and that site appears correctly
> in at least one Index node that is not the author's.

It deliberately excludes Cloudum. It uses the developer-independent Node runtime
plus a Cloudflare Tunnel. It is technical but reproducible: Docker, one DNS
record, one tunnel, the admin UI/API and the existing Index endpoints.

## 1. Roles and independence rules

| Role | Responsibility |
|---|---|
| **P1 — publisher** | Independent operator. Installs Portaless on their own machine/VPS, controls their own domain and publishes an APW-identified page. |
| **P2 — independent Index/verifier** | Different operator. Runs a separate Portaless node on a different domain, records a witness statement about P1, and publishes an Index entry for P1. |
| **Maintainer** | Observer only. May answer “where is the documentation?” but must not issue commands, edit P1/P2 systems, or create the identity/TXT/index records. |

Independence requirements:

- P1 and P2 use different domains and different Cloudflare accounts/zones.
- P2's Portaless instance is not hosted by the maintainer and is not the author's
  Index.
- The test uses a pinned repository commit and public documentation only.
- No private branch, prebuilt maintainer image, ad-hoc secret, or manual database
  edit is allowed.

## 2. Pass condition

The test passes only when all are true:

1. P1 installs and completes setup using the documented path.
2. P1 creates a `did:apw` identity and publishes the exact `_apw` TXT record.
3. P1 publishes an approved page served by its own Node runtime.
4. P2 records a witness statement about P1.
5. P2 synchronizes P1 into its own Index and publishes P1 in
   `https://<P2>/.well-known/apw-index.json`.
6. P2 independently resolves P1's identity and history successfully.
7. The recorded evidence shows **zero maintainer interventions**.

A failure is not converted into a “known limitation” if it blocks these steps.
It becomes a NOW remediation task.

## 3. Reference topology

```text
P1 operator                         P2 operator
p1.example.com                      p2.example.com
  Docker: Portaless Node              Docker: Portaless Node
  Cloudflare Tunnel (HTTPS)           Cloudflare Tunnel (HTTPS)
  APW identity + page                 APW identity + witness + Index
        │                                   │
        └──────── public HTTPS ─────────────┘
                    P2 verifies P1
```

Use two different Cloudflare zones/accounts. If both domains are subdomains of
the same zone, the test does **not** prove independent operation.

## 4. Prerequisites

Each operator needs:

- a Linux/macOS machine or VPS with Docker Engine/Desktop;
- `git`, `curl`, `jq`, `dig` (or `drill`);
- a Cloudflare account and zone for their own domain;
- `cloudflared` installed;
- outbound HTTPS.

The reference commit is the PR #113 merge commit on `main`:

```bash
export PORTALESS_REF=$(git rev-parse origin/main)
```

Record the actual `git rev-parse HEAD` in the evidence. If the test starts after a
newer `main`, use that commit and record it; do not mix commits between P1 and P2.

### 4.1 Runtime abuse controls (current behavior)

These are part of the system under test, not optional hardening:

- **Public origin.** `PORTALESS_PUBLIC_URL` is mandatory. The Compose files have
  no default and fail explicitly when it is missing. It must be the real HTTPS
  origin for P1/P2.
- **Login attempt budget (pre-hash).** `/admin/login` counts every valid-form
  attempt per client IP before running scrypt. After
  `PORTALESS_LOGIN_ATTEMPTS_PER_IP` (default `60`) attempts inside the 15-minute
  window, it returns `429` with `Retry-After` and
  `{"error":"rate_limited"}` without executing the hash.
- **Login failure limit (post-verification).** After `LOGIN_LIMIT_PER_IP` (20)
  failed credentials from the same IP, further failures also return `429`. The
  per-user bucket is recorded but never rejects, so a correct password still
  emits a session while the IP attempt budget is not exhausted. This is the
  anti-lockout property.
- **Scrypt concurrency.** Password hashing is asynchronous, so it no longer
  blocks the event loop. At most `PORTALESS_LOGIN_CONCURRENCY` (default `4`)
  verifications run at once. Each scrypt `N=2^17` uses ~128 MiB. The bounded
  queue holds at most 32 requests for 2 s; a full or timed-out queue returns
  `503 server_busy` without hashing.
- **Public `/trust/*` egress.** Public POST endpoints cap the body (64 KiB; 8 MiB
  for image verification), enforce per-IP/actor hourly budgets, and resolve APW
  data through a hardened fetcher with time, byte and request caps. A budget
  rejection is `429 rate_limited`; an oversized body is `413`.
- **Cloudflare Pages.** The dynamic page Function loads `node:fs`/`node:url`
  lazily and `wrangler.toml` declares `nodejs_compat`. The Node runtime remains
  the reference for P1/P2.

## 5. P1 — install the Node runtime

### 5.1 Clone and prepare

```bash
git clone https://github.com/geroiloyola/portaless.git
cd portaless
git checkout "$PORTALESS_REF"
git rev-parse HEAD
```

Create a local environment file. Do not commit it.

```bash
umask 077
cat > .env <<EOF
PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
PORTALESS_SETUP_CODE=$(openssl rand -hex 4)
PORTALESS_PUBLIC_URL=https://p1.example.com
PORTALESS_TRUSTED_PROXIES=127.0.0.1,::1
IP_HASH_SALT=$(openssl rand -hex 32)
EOF
chmod 600 .env
```

Create a Compose override that passes only the required variables:

```bash
cat > docker-compose.p1.yml <<'EOF'
services:
  portaless:
    environment:
      PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: ${PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY}
      PORTALESS_SETUP_CODE: ${PORTALESS_SETUP_CODE}
      PORTALESS_PUBLIC_URL: ${PORTALESS_PUBLIC_URL}
      PORTALESS_TRUSTED_PROXIES: ${PORTALESS_TRUSTED_PROXIES}
      IP_HASH_SALT: ${IP_HASH_SALT}
EOF
```

Start the canonical Node runtime:

```bash
docker compose -f docker-compose.yml -f docker-compose.p1.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.p1.yml ps
curl -fsS http://127.0.0.1:3000/healthz
```

Expected: `{"ok":true,"runtime":"portaless-node","sqlite":true}`.

### 5.2 Expose HTTPS with Cloudflare Tunnel

Install `cloudflared` for the platform, then:

```bash
cloudflared tunnel login
cloudflared tunnel create portaless-p1
cloudflared tunnel route dns portaless-p1 p1.example.com
```

Create the tunnel configuration. Use the tunnel UUID printed by `create` or:

```bash
export P1_TUNNEL_ID=$(cloudflared tunnel list --output json | jq -r '.[] | select(.name=="portaless-p1") | .id')
cat > "$HOME/.cloudflared/config-p1.yml" <<EOF
tunnel: $P1_TUNNEL_ID
credentials-file: $HOME/.cloudflared/$P1_TUNNEL_ID.json
ingress:
  - hostname: p1.example.com
    service: http://localhost:3000
  - service: http_status:404
EOF
```

Run it in a dedicated terminal or background process:

```bash
nohup cloudflared tunnel --config "$HOME/.cloudflared/config-p1.yml" run portaless-p1 \
  > "$HOME/cloudflared-p1.log" 2>&1 &
echo $! > "$HOME/cloudflared-p1.pid"
```

Verify public HTTPS:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://p1.example.com/healthz
```

`PORTALESS_TRUSTED_PROXIES=127.0.0.1,::1` is set in `.env` and passed by the
Compose override. `cloudflared` connects from loopback, so the runtime trusts its
`X-Forwarded-For` and the IP buckets follow the real client instead of the
tunnel. If Docker rewrites the source to the bridge gateway (for example
`172.17.0.1`), add that exact address too; matching is exact, never a CIDR range.
Without this, all clients share one bucket: 60 attempts from any client would
block every client for 15 minutes. This does not affect APW identity, publication
or Index discovery. For production, keep the trusted proxy list exact and
minimal, as documented in `docs/self-hosting.md`.

### 5.3 Complete setup

Open `https://p1.example.com/setup`, enter the value of
`PORTALESS_SETUP_CODE` from `.env`, and create the admin account. Use a unique
password. If 2FA is enabled, use the browser for the admin steps below; the
`curl` examples assume password-only login.

Verify the login endpoint and cookie:

```bash
read -r -s -p 'P1 admin password: ' P1_ADMIN_PASSWORD; echo
curl -sS -c p1.cookies -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -X POST https://p1.example.com/admin/login \
  -H 'Origin: https://p1.example.com' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=admin' \
  --data-urlencode "password=$P1_ADMIN_PASSWORD"
grep -q portaless_session p1.cookies
```

Expected: `302` and a `portaless_session` cookie. If 2FA is enabled, complete the
browser MFA flow instead.

Do not use this endpoint for a brute-force demo before the rest of the test. After
20 failed attempts from the same IP, failures return `429 rate_limited` with
`Retry-After`; the correct password still works because the per-user bucket does
not reject. After 60 total attempts from that IP, the pre-hash budget also
returns `429` until the 15-minute window rolls over, including for a correct
password. With `PORTALESS_TRUSTED_PROXIES` set, that only affects the client that
spent the budget; without it, it affects every client behind the tunnel.

## 6. P1 — create APW identity and publish

### 6.1 Create the identity

```bash
curl -sS -b p1.cookies -X POST https://p1.example.com/admin/api/site-identity \
  -H 'Origin: https://p1.example.com' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"p1.example.com"}' \
  | jq '{identity: .identity, didDocument: .didDocument, privateKeyReturned: (.privateKeyJwk != null)}'
```

The response contains a private key once. Do **not** save it in evidence. It is
already stored encrypted by Portaless. If the API returns `409
identity_already_exists`, read the existing identity with:

```bash
curl -sS -b p1.cookies https://p1.example.com/admin/api/site-identity \
  | jq '{identity: {did: .identity.did, domain: .identity.domain}}'
```

### 6.2 Publish the `_apw` TXT record

Get the exact record:

```bash
curl -sS -b p1.cookies https://p1.example.com/admin/api/apw-verification-status \
  | tee p1-verification.json \
  | jq '{verified, reason, txtRecord, anchor, identity: {did: .identity.did, k: .identity.k, h: .identity.h}}'
export P1_TXT_NAME=$(jq -r '.txtRecord.name' p1-verification.json)
export P1_TXT_VALUE=$(jq -r '.txtRecord.value' p1-verification.json)
printf 'TXT %s = %s\n' "$P1_TXT_NAME" "$P1_TXT_VALUE"
```

Create the record at the P1 DNS provider. The name is relative to the zone:
for `p1.example.com` in zone `example.com`, create TXT name `_apw.p1` with the
exact value, TTL 300. Do not add quotes inside the value; the provider adds TXT
quoting.

Optional Cloudflare API equivalent:

```bash
export CF_API_TOKEN=...          # Zone.DNS edit
export CF_ZONE_ID=...
export P1_TXT_REL=_apw.p1
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg name "$P1_TXT_REL" --arg content "$P1_TXT_VALUE" \
    '{type:"TXT",name:$name,content:$content,ttl:300}')" \
  | jq '{success, errors, result: {id: .result.id, name: .result.name}}'
```

If the record already exists, use `PATCH` with its record ID instead of `POST`.

Wait for propagation:

```bash
export P1_TXT_FQDN=_apw.p1.example.com
for i in $(seq 1 30); do
  dig +short TXT "$P1_TXT_FQDN" | tr -d '"' | grep -F "$P1_TXT_VALUE" && break
  sleep 10
done
dig +short TXT "$P1_TXT_FQDN"
```

Verify APW:

```bash
curl -sS -b p1.cookies https://p1.example.com/admin/api/apw-verification-status \
  | jq '{verified, reason, anchor, identity: {did: .identity.did, k: .identity.k, h: .identity.h, verified: .identity.verified}}'
```

Expected: `verified: true`, `identity.verified: true`. `anchor.status` may be
`no_history` at this point.

### 6.3 Add one signed history entry

A witness statement needs a non-empty subject chain. Create one signed `self`
attestation:

```bash
curl -sS -b p1.cookies -X PUT https://p1.example.com/admin/site-trust/default/self \
  -H 'Origin: https://p1.example.com' \
  -H 'Content-Type: application/json' \
  -d '{"category":"contact_transparency","declaredValue":true,"evidenceUrl":"https://p1.example.com/"}' \
  | jq '{ok, signed, logged, logReason, jti}'
```

Expected: `signed: true`, `logged: true`.

Fetch the new TXT value (it now includes `h`), update the same `_apw.p1` record,
wait for propagation, and verify again:

```bash
curl -sS -b p1.cookies https://p1.example.com/admin/api/apw-verification-status \
  | tee p1-verification.json \
  | jq '{verified, anchor, txtRecord}'
export P1_TXT_VALUE=$(jq -r '.txtRecord.value' p1-verification.json)
# Update the TXT record with the new value, then:
for i in $(seq 1 30); do
  dig +short TXT "$P1_TXT_FQDN" | tr -d '"' | grep -F "$P1_TXT_VALUE" && break
  sleep 10
done
curl -sS -b p1.cookies https://p1.example.com/admin/api/apw-verification-status \
  | jq '{verified, anchor, identity: {did: .identity.did, k: .identity.k, h: .identity.h, verified: .identity.verified}}'
```

Expected: `verified: true`, `anchor.status: "up_to_date"`.

### 6.4 Publish a page

In the browser:

1. Open `https://p1.example.com/admin/editor`.
2. Create a page with slug `p1-pilot`.
3. Add a heading and a paragraph with a unique marker, e.g.
   `P1-P2-ADOPTION-MARKER`.
4. Publish the page.
5. Open `https://p1.example.com/pages/p1-pilot/`.

Verify from the CLI:

```bash
curl -fsS -o /tmp/p1-page.html -w '%{http_code}\n' https://p1.example.com/pages/p1-pilot/
grep -F 'P1-P2-ADOPTION-MARKER' /tmp/p1-page.html
```

The page is served by P1's Node runtime. GitHub Pages projection is optional and
is **not** part of this test.

Record the public page URL and its status.

## 7. P2 — install the independent Index node

P2 repeats §5 and §6.1–§6.2 with its own domain, Cloudflare account and secrets:

- replace `p1.example.com` with `p2.example.com`;
- replace `P1_` variables with `P2_`;
- replace tunnel name `portaless-p1` with `portaless-p2`;
- create the TXT `_apw.p2` for `p2.example.com`.

P2 does **not** need a page or a self attestation. It needs a verified APW
identity so it can sign a witness statement and publish an Index document.

P2 login and identity check:

```bash
read -r -s -p 'P2 admin password: ' P2_ADMIN_PASSWORD; echo
curl -sS -c p2.cookies -o /dev/null -w '%{http_code}\n' \
  -X POST https://p2.example.com/admin/login \
  -H 'Origin: https://p2.example.com' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=admin' \
  --data-urlencode "password=$P2_ADMIN_PASSWORD"

curl -sS -b p2.cookies https://p2.example.com/admin/api/apw-verification-status \
  | jq '{verified, anchor, identity: {did: .identity.did, k: .identity.k, h: .identity.h, verified: .identity.verified}}'
```

Expected: `verified: true`, `identity.verified: true`.

## 8. P2 — witness P1 and publish the Index entry

### 8.1 Record a witness statement

P1 must be at its final chain head before this step. Do not create more P1
attestations after P2 records the witness.

```bash
curl -sS -b p2.cookies -X POST https://p2.example.com/admin/api/witness/record \
  -H 'Origin: https://p2.example.com' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"p1.example.com"}' \
  | tee p2-witness.json \
  | jq '{logged, reason, entry}'
```

Expected: `logged: true`. If `logged: false`, stop and record the reason; do not
continue to the Index sync.

### 8.2 Anchor P2's new history head

Recording the witness adds an entry to P2's chain. Fetch the new TXT value,
update `_apw.p2`, wait for propagation, and verify:

```bash
curl -sS -b p2.cookies https://p2.example.com/admin/api/apw-verification-status \
  | tee p2-verification.json \
  | jq '{verified, anchor, txtRecord}'
export P2_TXT_VALUE=$(jq -r '.txtRecord.value' p2-verification.json)
# Update _apw.p2 with this value, then:
for i in $(seq 1 30); do
  dig +short TXT _apw.p2.example.com | tr -d '"' | grep -F "$P2_TXT_VALUE" && break
  sleep 10
done
curl -sS -b p2.cookies https://p2.example.com/admin/api/apw-verification-status \
  | jq '{verified, anchor, identity: {did: .identity.did, k: .identity.k, h: .identity.h, verified: .identity.verified}}'
```

Expected: `anchor.status: "up_to_date"`.

**Current code behavior (E-04):** the Index sync verifies P2's chain, the witness
statement signature and the `(iss, jti)` uniqueness. It does **not** require the
witness statement to be anchored in P2's current TXT `h`; `statement_not_anchored`
is only returned when the referenced `seq` is absent from the fetched page. This
protocol is deliberately stricter: do not record a passing result if
`anchor.status` is not `up_to_date`. An unanchored witness may still be accepted
by the code, but it is not valid evidence for this test. Fix DNS and re-run §8.2
before §8.3.

### 8.3 Synchronize P1 into P2's Index

```bash
curl -sS -b p2.cookies -X POST https://p2.example.com/admin/api/index/sync \
  -H 'Origin: https://p2.example.com' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"p1.example.com","witnesses":["p2.example.com"]}' \
  | tee p2-index-sync.json \
  | jq '{synced: {subjectDid: .synced.subjectDid, status: .synced.status, length: .synced.length, head: .synced.head, witnessesUsed: .synced.witnessesUsed, witnessesSkipped: .synced.witnessesSkipped, consensus: .synced.consensus}}'
```

Expected:

- `synced.status: "consistent"`;
- `witnessesUsed` contains `did:apw:p2.example.com`;
- `witnessesSkipped` is empty or explains a non-blocking skip.

If the result is `head_mismatch`, P1's head changed after P2's witness. Re-run
§8.1 after freezing P1, then §8.2 and §8.3.

### 8.4 Verify the public Index document

```bash
curl -sS https://p2.example.com/.well-known/apw-index.json \
  | tee p2-apw-index.json \
  | jq --arg d 'p1.example.com' '.subjects[] | select(.domain==$d) | {subjectDid,domain,status,length,head,witnessesUsed,consensus,syncedAt}'
```

Expected: one entry for `p1.example.com`, `status: "consistent"`, and
`witnessesUsed` containing P2's DID. The document's `iss` is P2's DID, not P1's.

Also record:

```bash
curl -sS -b p2.cookies 'https://p2.example.com/admin/api/index/subjects?subject=did:apw:p1.example.com' \
  | jq
```

## 9. P2 — independent verification of P1

Run from the pinned repository checkout on P2's machine:

```bash
cat > /tmp/verify-apw.mjs <<'EOF'
import { resolveApwIdentity, resolveApwHistory } from './packages/apw-resolver/src/index.ts';
const host = process.argv[2];
const identity = await resolveApwIdentity(host);
const history = await resolveApwHistory(host, fetch, { includeEntries: true, includeKeys: true });
console.log(JSON.stringify({
  identity: {
    verified: identity.verified,
    reason: identity.reason,
    did: identity.did,
    keyThumbprint: identity.keyThumbprint,
  },
  history: {
    verified: history.verified,
    reason: history.reason,
    length: history.length,
    head: history.head,
    anchoredSeq: history.anchoredSeq,
    unanchoredEntries: history.unanchoredEntries,
  },
}, null, 2));
EOF

node --import tsx /tmp/verify-apw.mjs p1.example.com | tee p2-p1-verification.json
node --import tsx /tmp/verify-apw.mjs p2.example.com | tee p2-self-verification.json
```

Expected for P1:

- `identity.verified: true`;
- `history.verified: true`;
- `history.unanchoredEntries: 0`.

The Index entry is not accepted merely because P2 published it. P2 must compare
the Index entry's `subjectDid`, `head`, and `witnessesUsed` with the resolver
output above.

Fetch the public APW artifacts as additional evidence:

```bash
curl -fsS https://p1.example.com/.well-known/did.json \
  | jq '{id, key: .verificationMethod[0].publicKeyJwk | {kty,crv}}'
curl -fsS https://p1.example.com/.well-known/apw-manifest.jws | head -c 120; echo
curl -fsS 'https://p1.example.com/.well-known/apw-log.json?from=1&limit=500' \
  | jq '{did,length,next,entries:(.entries|length)}'
curl -fsS https://p2.example.com/.well-known/apw-witnesses.json \
  | jq '{did,length,next,entries:(.entries|length)}'
```

## 10. Evidence package

Save a single `p1-p2-evidence.json` (redacted) plus screenshots/logs. Do not
include passwords, cookies, private keys, setup codes, API tokens or encryption
keys.

```json
{
  "protocol": "p1-p2-adoption-v1",
  "startedAt": "2026-10-25T00:00:00Z",
  "finishedAt": "2026-10-25T00:00:00Z",
  "portalessRef": "7334e95",
  "maintainerInterventions": 0,
  "p1": {
    "host": "p1.example.com",
    "operator": "P1",
    "identityDid": "did:apw:p1.example.com",
    "txtName": "_apw.p1.example.com",
    "identityVerified": true,
    "anchorStatus": "up_to_date",
    "pageUrl": "https://p1.example.com/pages/p1-pilot/",
    "pageHttpStatus": 200
  },
  "p2": {
    "host": "p2.example.com",
    "operator": "P2",
    "identityDid": "did:apw:p2.example.com",
    "witnessRecorded": true,
    "indexSyncStatus": "consistent",
    "indexUrl": "https://p2.example.com/.well-known/apw-index.json",
    "p1Entry": {
      "subjectDid": "did:apw:p1.example.com",
      "status": "consistent",
      "witnessesUsed": ["did:apw:p2.example.com"]
    },
    "p1IdentityVerified": true,
    "p1HistoryVerified": true,
    "p1UnanchoredEntries": 0
  },
  "evidenceFiles": [
    "p1-verification.json",
    "p2-witness.json",
    "p2-verification.json",
    "p2-index-sync.json",
    "p2-apw-index.json",
    "p2-p1-verification.json",
    "p2-self-verification.json"
  ],
  "result": "pass"
}
```

Attach:

- terminal transcripts (redacted);
- screenshots of P1 identity verification, P1 page, P2 witness result and P2
  Index entry;
- DNS record screenshots or API responses;
- timestamps and `docker compose ps`;
- every point where documentation was insufficient.

## 11. Documentation audit findings

The P1/P2 audit found these onboarding issues. The first was corrected in this
protocol PR; the rest are recorded so the test can distinguish product gaps from
operator mistakes.

| Finding | Severity | Current state | Action |
|---|---|---|---|
| `docs/first-steps.md` told Docker users to open port `4321`; Compose maps `3000` | High | Corrected to `3000` in this PR | Verify the guide opens `http://localhost:3000/setup` |
| GitHub Pages static hosting cannot serve `/.well-known/did.json`, `apw-log.json` or `apw-witnesses.json` | High | P1/P2 must use Node runtime or Cloudflare Pages Functions | Protocol uses Node self-host; do not claim APW identity from GitHub Pages alone |
| No end-to-end “run an independent Index node” guide | High | Admin API docs exist, but no operator sequence | This protocol supplies the exact P2 sequence |
| No documented sequence for anchoring a witness statement after `witness/record` | High | `apw-verification-status` exposes the new `h`, but the P2 flow was not documented | §8.2 makes the TXT update explicit |
| No TLS/reverse-proxy path for a standalone Node pilot | Medium | `self-hosting.md` covers Docker but not public HTTPS | Protocol uses Cloudflare Tunnel |
| `first-steps.md` mixes local publication with GitHub Pages publication | Medium | Local page publishing works; GitHub Pages is optional | Protocol treats the Node-served page as the publication for this test |
| Cloudflare Pages D1 binding/CLI is not a complete copy-paste path | Medium | `DEPLOY_CLOUDFLARE_PAGES.md` names the binding but not the exact dashboard/CLI steps | Not used in this P1/P2 path |
| ChatGPT write flow is `blocked_unverified` | Medium | Local MCP passes; external account/client not tested | Separate product-story decision; not required for P1/P2 |

## 12. Failure handling

| Symptom | Likely cause | Required action |
|---|---|---|
| `healthz` unreachable | Container not running or tunnel misconfigured | Check `docker compose ps`, `cloudflared` log, DNS CNAME |
| `/setup` 404 | Wrong port or URL | Use `https://<host>/setup`; for local Docker use `3000` |
| APW `verified:false` | TXT missing, wrong name/value, propagation, or `did.json` unreachable | Re-read `txtRecord`, verify `dig`, check `/.well-known/did.json` |
| `anchor.status: stale` | New history entry but old `h` in TXT | Update TXT with the new `txtRecord.value`, wait, re-check |
| Witness `logged:false` | P1 chain invalid/unreachable, P2 identity missing, or duplicate | Record reason; do not proceed |
| Index `statement_not_anchored` | The referenced witness `seq` is absent from the fetched P2 log page (not merely unanchored in TXT) | Re-verify P2 history and TXT; do not record the run |
| Index `head_mismatch` | P1 changed after P2 witnessed | Freeze P1, re-record witness, update P2 TXT, re-sync |
| Index `witnessesSkipped` includes P2 | P2 chain/TXT or statement invalid | Re-verify P2 identity/history; do not hide the skip |
| P2 Index has no P1 | Sync used wrong domain/witness or P1 index not public | Check `domain`, `witnesses`, P1 endpoints |

## 13. Exit and ownership

This protocol produces evidence; it does not itself approve the Beta. The owner
and an independent reviewer decide whether the recorded result satisfies the
Beta exit criterion.

If the test passes with zero maintainer interventions, record it in the release
evidence and update the roadmap status. If it fails, the failure owner is the
component owner of the failing step; do not mark the Beta exit as passed.

G5 remains frozen. This protocol does not authorize LTP runtime integration,
offline DNSSEC or a Nuvid bridge.
