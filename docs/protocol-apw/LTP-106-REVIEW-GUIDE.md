# #106 review guide — SSRF, budget, transport, verification and documentation

**For:** linstarkcorp (reviewer). **Owner:** geroiloyola. **Status of #106:**
open, no reviews yet, head `48f940a`, base `5f92732` (merge of #105). This guide
does not approve or merge anything; it only points at what to inspect and how to
reproduce it.

## 1. Scope of #106 vs. #105

#105 merged the identity engine. #106 hardens its real connector and records the
bounded G2/G3 acceptance. The verifier, JWS helpers and canonicalization were
introduced in #105 and are **not changed by #106**; #106 only touches transport,
SSRF, budget accounting, tests and documentation.

Expected diff outside `packages/ltp-engine/` on #106: none (except docs). Verify:

```bash
git diff --stat 5f92732..48f940a -- packages functions server src
git diff --exit-code 5f92732..48f940a -- \
  packages/ltp-engine/src/verification.ts \
  packages/ltp-engine/src/jws.ts \
  packages/ltp-engine/src/canonical.ts
```

The second command should print nothing. G4/G5 code must not appear anywhere:
`git diff --exit-code 5f92732..48f940a -- packages/apw-resolver/src/scoring`.

## 2. Review groups and exact commits

| Group | Commits | What to check |
|---|---|---|
| SSRF policy | `9bb5c37`, `bf9992c` | CIDR coverage, hostname normalization, all-answer rejection, pinning, no connector call, socket test. |
| Budget | `bf9992c`, `fab9a43` | Attempts/bytes/signatures charged before the operation; failed attempts never refunded. |
| Transport | `9bb5c37` | HTTPS-only, no redirects, TLS validation, streamed cap, deadline, Node-only boundary. |
| Verification | inherited from #105 (`74d3918` etc.) | AB-STATIC-01…07, tamper regressions, JWS/JCS. Confirm #106 did not alter verifier files. |
| Documentation/governance | `81a1e60`, `04f334e`, `5b544d2`, `cda0580`, `48f940a` | Gate states, Workers limitation, DoH smoke prerequisites, G4/runtime reports, approval re-pin. |

### 2.1 SSRF policy — `9bb5c37`, `bf9992c`

Inspect:

- `packages/ltp-engine/src/ssrf.ts:121` `isBlockedIp`: IPv4/IPv6 ranges, mapped
  IPv4, NAT64, 6to4, ULA, link-local, metadata, documentation, multicast,
  reserved.
- `ssrf.ts:143` `isBlockedHostname`: trailing dot, uppercase, `localhost`,
  `.local`, `.internal`, `.example`, `.test`, `.invalid`, `.lan`, `.onion`.
- `ssrf.ts:152` `assertSafeEndpointUrl`: HTTPS, userinfo, fragment, blocked host.
- `ssrf.ts:173` `resolvePinnedAddress`: resolve all answers, reject the whole
  name if **any** answer is blocked, return the single address to pin.
- `packages/ltp-engine/src/transport.ts:68` `defaultOpen`: `rejectUnauthorized`,
  `servername`, pinned `lookup`, redirect rejection, content-length/stream caps.
- `transport.ts:143` `FetchTransport.send`: URL check before DNS, deadline race,
  pin before connector, status/body checks.

Covered by `tests/unit/ltp-engine-ssrf.test.ts`:

| Concern | Test line |
|---|---|
| CIDR matrix, mapped/NAT64 | `:53` |
| Special hostnames | `:58` |
| Plaintext/credentials/fragment/literals | `:67` |
| Trailing dot, uppercase, IDN/punycode, IPv6 zone, `0.0.0.0` | `:77` |
| Mixed public+private DNS → full rejection | `:100` |
| Resolver called once, pinned address used | `:110` |
| Real loopback listener receives 0 connections | `:132` |
| No connector call on private DNS | `:155` |
| Redirect refused | `:165` |
| Declared/streamed cap | `:173` |
| Real TLS rejects self-signed | `:186` |
| Hanging connect aborts at deadline | `:212` |

Fail conditions: any blocked destination reaches the injected connector, a
second resolver call occurs before connect, a redirect is followed, a self-signed
certificate is accepted, or the loopback listener receives a connection.

### 2.2 Budget — `bf9992c`, `fab9a43`

Inspect `packages/ltp-engine/src/budget.ts:54-77`:

- HTTP attempt increments **before** `send`; a failed hop keeps it.
- Body allowance is **pre-charged** at reservation; a failed/timeout hop keeps
  the full reservation; a completed response refunds only `cap - actual`.
- Signature attempt increments **before** verification; a bad signature keeps it.
- Shared exclusive deadline and no reset.

Covered by:

- `tests/unit/ltp-engine-ssrf.test.ts:238` failed HTTP attempt keeps
  `httpAttemptsUsed=1` and `bodyBytesUsed=dohBytes`.
- `tests/unit/ltp-engine-ssrf.test.ts:256` the failed Ed25519 attempt is counted
  (`signatureAttemptsConsumed=4` for AB-STATIC-07).
- `tests/unit/ltp-engine-composed.test.ts:146` pre-charge/no-refund and
  refund-only-unused.
- `ltp-engine-composed.test.ts:126-158` deadline, attempts, caps.

Fail condition: a failed attempt reduces `bodyBytesUsed` or
`signatureAttemptsUsed`, or a timeout refunds the byte reservation.

### 2.3 Transport — `9bb5c37`

Inspect `packages/ltp-engine/src/acquisition.ts`:

- configured endpoints must be exact HTTPS URLs with no query/credentials/fragment;
- subject must be a DNS A-label, not an IP literal;
- `dohBytes`, package cap and total body cap are enforced before parsing;
- failure classes (`ssrf_blocked`, `dnssec_required`, `bootstrap_unsupported`,
  `response_limit_exceeded`, `deadline_exceeded`) do not fall back.

Covered by `ltp-engine-ssrf.test.ts:280-437` (IP-literal subject, endpoint query,
malformed DoH, AD=false, attempt/body/deadline/signature caps, final composed
success) and `ltp-engine-composed.test.ts:64` (AB-STATIC-02 makes one hop only).

### 2.4 Verification — inherited, unchanged

Run `tests/unit/ltp-engine-composed.test.ts` (17 tests). It executes
AB-STATIC-01…07 in memory, compares the literal expected objects and the frozen
handoff, and rejects an inner signature mutation after outer digest and prefix
repairs. Confirm the diff command in §1 prints nothing; #106 did not edit
`verification.ts`, `jws.ts` or `canonical.ts`.

### 2.5 Documentation/governance — `81a1e60`, `04f334e`, `5b544d2`, `cda0580`, `48f940a`

Check:

- `LTP-GATES-AND-AUTHORIZATIONS.md:3-40`: G1–G3 accepted; G4/G5
  `PENDING_AUTHORIZATION`; no automatic transition.
- `LTP-G2-G3-IMPLEMENTATION-SCOPE.md:77`: Node-only; Cloudflare Workers not
  covered/authorized.
- `LTP-G2-G3-IMPLEMENTATION-SCOPE.md:90`: controlled DoH smoke test requires
  operator consent and is not executed in CI.
- `LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md`: no G4 code; binary64+tolerance
  cited; “2 emitters” is a maximum fan-out cap.
- `docs/architecture/ltp-runtime-integration-proposal.md`: proposal only; B3
  unchanged; no runtime import.
- `LTP-APPROVAL-RECORD.md`: re-pinned G1 tuple after prose changes; owner
  decision remains G1-only.

## 3. Reproduce the 16 asset tests

Prerequisites: Node 24, `openssl`, and Python dependencies used by the external
DNSSEC checks.

```bash
cd docs/protocol-apw
npm ci --ignore-scripts --no-audit --no-fund
python3 -m venv /tmp/ltp-assets-venv
/tmp/ltp-assets-venv/bin/pip install -r requirements-audit.txt
LTP_PYTHON=/tmp/ltp-assets-venv/bin/python npm test
```

Expected tail:

```text
tests 16
pass 16
fail 0
```

If the Python venv is omitted, `assets.test.mjs` fails at the external
OpenSSL/JOSE/dnspython check; that is an environment failure, not a fixture
failure. `openssl version` must succeed.

## 4. Reproduce the SSRF/budget/transport tests

```bash
# 24 SSRF/transport tests (includes the local TLS/loopback checks)
node node_modules/vitest/vitest.mjs run tests/unit/ltp-engine-ssrf.test.ts

# 17 composed verification/budget tests
node node_modules/vitest/vitest.mjs run tests/unit/ltp-engine-composed.test.ts
```

Expected: `24 passed` and `17 passed`. The TLS self-signed test returns early if
`openssl` is unavailable; the socket zero-connection test always runs.

## 5. Full gate (same as CI)

```bash
node node_modules/vitest/vitest.mjs run
npm run build
node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts
npx playwright test
```

Expected on `48f940a`: Vitest **2,355 passed / 2 skipped**, build **79 pages**,
manifests **2 valid**, Playwright **75 passed**, CI **10/10**.

## 6. Reviewer checklist

- [ ] No G4/G5 implementation or reputation math in the diff.
- [ ] Blocked destinations never reach the connector; loopback listener stays at 0.
- [ ] DNS is resolved once and the verified address is pinned.
- [ ] Redirects/plaintext/self-signed TLS are rejected.
- [ ] Failed attempts keep HTTP/byte/signature charges.
- [ ] AB-STATIC-01…07 still match exactly; verifier files unchanged.
- [ ] Workers limitation and DoH smoke prerequisites are explicit.
- [ ] Gate states at the #106 review revision are G1–G3 accepted, G4/G5 pending; the canonical register records the later G4 engine authorization.
- [ ] Approval record re-pin matches the final prose commit.

Do not approve or merge from this guide; linstarkcorp reviews and the owner
decides.
