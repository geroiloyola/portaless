# LTP Stack MVP and Portaless official Beta — decision proposal

**Status: owner-approved strategy (Beta-first, 2026-10-25). A/B/C remain
paused; G5 remains frozen. The implementation sections are proposals, not
authorizations. No code, migration, activation or gate change is included.**
Baseline: `main` at `7334e95` (PR #108 merge), 2026-10-25.
License: CC BY 4.0 for this proposal; code remains AGPL-3.0.

## 1. Decision summary

The official Beta is **not** an LTP gate milestone. The repository already
defines its exit criterion as an external adoption fact:

> a person outside the project, without the author's direct help, installs
> Portaless, publishes a site with APW identity, and that site appears correctly
> in at least one Index node that is not the author's.

That fact is not demonstrated today. The shortest path to the official Beta is
therefore **not** to wire G2/G3/G4 into middleware. It is to run the external
operator/Index test, record where it fails, and close those product/documentation
gaps.

**Recommendation, in priority order:**

1. **NOW — prove the Beta exit criterion** with one external publisher and one
   independent Index/verifier. This is the highest-risk, highest-information
   action.
2. **NOW — decide the product-story blockers** that the owner still includes in
   “Beta”: real GitHub publish, ChatGPT write flow, Cloudum, independent human
   review. Do not call them passed from local fixtures.
3. **NEXT — optional minimal LTP runtime verification**, only if the LTP Stack
   MVP explicitly requires Proof Package verification. It is not required for
   the existing APW/Index Beta path.
4. **GATED — middleware enforcement, Workers LTP, G5, real-emitter reputation,
   cross-instance quotas.**
5. **OUT OF SCOPE — Nuvid compiler, hosted Nuvid bridge, G4 as an enforcement
   authority.**

G2/G3/G4 may remain decoupled during the Beta. G4 must not be used as a
raw-evidence verifier or as a grant authority.

## 2. What the existing acceptance criteria actually say

There are two different contracts. They must not be collapsed.

### 2.1 Official Beta exit criterion

From `ROADMAP.md` Phase 5:

- an outside person installs Portaless without the author's direct help;
- publishes a site with APW identity;
- that site appears correctly in at least one Index node that is not the
  author's.

This is the close of the official Beta. “Public Beta announced” already exists;
“official Beta” does not. The roadmap also lists a second real implementer
(Phase 4) and 3–5 non-technical onboarding sessions (Phase 5 item 3); those are
roadmap prerequisites/quality targets, not evidence that can be inferred from
local tests.

### 2.2 Expanded MVP acceptance contract

`docs/mvp/acceptance-contract.md` defines a broader product contract: private
canonical node, public Git projection, AI editing, privacy, restore/handover,
resource budget, mobile navigation and release evidence. It is accepted as
requirements but only partially implemented/externally verified.

The official Beta exit fact does **not** automatically satisfy every expanded
MVP item, and local MVP evidence does **not** prove the official Beta exit fact.
Both must be stated separately.

## 3. MVP / Beta status by evidence

| Criterion | Status | Current evidence | Gap |
|---|---|---|---|
| Local Docker install + browser setup | **PARTIAL** | `docs/first-steps.md`; Docker setup and first-run tests | No external person has completed it unaided |
| Editor → publish on the canonical node | **NOW (local)** | Editor/publish tests, Playwright, release evidence | External publisher flow not demonstrated |
| APW identity + DNS TXT publication | **PARTIAL** | `did:apw` generation, TXT/manifest tests, dashboard checklist | A non-author domain has not completed the flow |
| Independent Index discovery | **NOT DEMONSTRATED** | Inter-node sync and witness aggregation exist; no real peers | No public federation endpoint; no Index node run by another operator |
| Third-party APW verification | **PARTIAL** | `resolveApwManifest`, `/trust/:siteId`, vectors | No independent third party has verified an external operator's site |
| Official Beta exit | **NOT DEMONSTRATED** | Roadmap Phase 5 remains open | External operator + independent Index test not run |
| Draft/private data not public | **NOW (local)** | Runtime 404, clean export, private-marker tests | Not a proof about deliberate historical leaks |
| Git publication only approved revisions | **PARTIAL** | Local clean-export and publish/unpublish tests | Real GitHub account publish is `not_run` |
| Restore/handover with one writer | **PARTIAL** | Local backup/restore and single-writer tests | Cloudum/cross-host handover is external |
| ChatGPT custom MCP write flow | **NOT DEMONSTRATED** | `blocked_unverified` | No account/workspace, client, model or HTTPS tunnel evidence |
| OpenAI-compatible provider | **PARTIAL** | Local contract and loopback mock | External provider is `not_run` |
| One-row 320 px navigation | **NOW (local)** | Playwright mobile matrix | External browser/device evidence not required by roadmap |
| 20 GB / 2 GiB budget | **NOW (reference fixture)** | `scripts/resource-budget.mjs` | Not a Cloudum SLA or a different workload guarantee |
| Independent human review | **NOT DEMONSTRATED** | `release-evidence.json` says pending | Reviewer outside the implementation is required |
| LTP G2/G3 identity engine | **ACCEPTED library** | AB-STATIC-01…07, SSRF/TLS/budget tests | Not imported by runtime; Node-only |
| LTP G4 static engine | **ACCEPTED static engine** | 117 cases, 13 `svri-math` differential cases | Not raw evidence; not runtime-wired |
| LTP G5 offline DNSSEC | **FROZEN** | Gate register | No authorization or validator |

## 4. Does G2/G3/G4 need to be integrated for the Beta?

**No, not for the official Beta exit criterion as currently written.**

Reasons:

- The existing Portaless APW path uses `apw-resolver` for identity, history,
  trust pages, witnesses and Index discovery. It does not import
  `packages/ltp-engine`.
- The LTP identity engine verifies the newer `apw-identity-proof-v1` Proof
  Package profile. That profile is not the existing APW TXT/did.json/Index
  path, and no runtime request currently supplies such a package.
- G4 is a static decision-case evaluator over explicit verifier facts. It does
  not parse JWS, resolve DNS, verify chains or read raw attestations. It cannot
  replace the existing `apw-resolver` evidence path.
- Wiring these engines would add a new runtime trust boundary, new failure
  modes, new configuration and a Workers problem, while not changing the Beta
  exit fact.

They become relevant only if the owner explicitly expands the MVP to require
LTP Proof Package verification in the runtime. That is a separate product
decision, not a Beta prerequisite.

### 4.1 What can remain decoupled

- G2/G3 identity acquisition/verification: decoupled from middleware.
- G4 static calculation: decoupled from grants, enforcement and public scores.
- G5: frozen.
- Workers LTP path: gated.

### 4.2 What must not be claimed

- “LTP runtime is integrated” because a package exists.
- “Reputation works” because G4 has static vectors.
- “Workers are covered” because the Node connector passes.
- “Official Beta” because internal gates or local release evidence pass.

## 5. Option A — minimal runtime flow

### 5.1 Scope: one flow, not a platform

If the owner wants an LTP runtime MVP, the smallest useful flow is an
**admin-only, Node-only verification endpoint**. Do not start with middleware
enforcement, grants, Workers or G4.

```text
Admin request
  POST /admin/api/ltp/verify
  { subject: "did:apw:example.com",
    profile: "apw-identity-proof-v1",
    bootstrapProfile: "independent-doh-ad-v1" }
        │
        ├─ admin session + same-origin/body guard
        ├─ fixed operator DoH + Index from server config
        ├─ acquireIdentity / verifyHandoff with one ResourceBudget
        └─ structured result: identity, history, reason, expiry
             (no grant, no score, no public content decision)
```

This proves the G2/G3 engine in the real Node runtime without changing public
request behavior. It is a diagnostic/verification surface, not an authorization
surface.

### 5.2 Resource limits

Use the existing D7 ceilings unchanged:

- 4 MiB total body bytes;
- 64 KiB DoH bytes;
- 512 KiB package bytes;
- 640 signature attempts;
- 24 HTTP attempts;
- 10,000 ms shared deadline.

The endpoint may lower limits, never raise them. No retry loop, no deadline
reset, no fallback to another resolver, no unsigned DNS fallback. Failed attempts
keep their pre-charged bytes and attempt count. The request must abort its
connector at the deadline; Node DNS may finish late but its result is discarded.

Add an admin/route admission limit separate from the D7 budget. It may be
per-process for the MVP; do not claim a cross-instance quota.

### 5.3 Expected failures

Return structured, non-secret results for:

- unsupported profile/bootstrap;
- invalid DID or subject mismatch;
- DNS unavailable, NXDOMAIN, no TXT, AD false, truncated/ambiguous answer;
- Index unavailable or malformed package;
- package digest/target/key-set/history mismatch;
- bad signature, key window, checkpoint, seq/prev, freshness;
- deadline, budget, response cap;
- misconfigured server endpoint.

Never convert an infrastructure failure into a grant, a negative reputation
fact or a 200 “unverified” result. The endpoint is not a public oracle and does
not expose raw proofs, DNS messages or secrets.

### 5.4 Security controls

- Fixed operator-configured HTTPS DoH and Index endpoints; no request-supplied
  URLs, resolver IDs or redirects.
- Node pinned DNS and TLS validation from the accepted G2 connector.
- No arbitrary-origin fetch; no package-nominated URLs.
- No Index key used as a subject/issuer key.
- No package field can grant access or set trust.
- Admin-only; CSRF/same-origin/body guards; bounded response.
- No logs of raw IPs, signatures, keys or private proof material.
- If the endpoint cannot be safely configured, it stays absent or returns
  `503`/`unsupported`; it does not enable a weaker path.

### 5.5 Acceptance tests

- valid AB-STATIC-01 through the real Node runtime with a controlled fixture
  transport;
- AB-STATIC-02…07 failure classes mapped correctly;
- malformed JSON/package, bad digest, bad inner signature;
- SSRF/private host/redirect/TLS/oversized body;
- budget and deadline exhaustion, including late DNS discard;
- admin auth, same-origin, body-size and rate limits;
- no grant, no public route change, no score change;
- feature absent/disabled in Workers with an explicit reason.

A controlled live DoH/Index smoke test still requires operator consent; it is
not authorized by this proposal.

### 5.6 Effort and risk

Planning estimate: **2–4 engineering weeks** for the admin-only Node flow plus
live acceptance, excluding middleware, grants and Workers.

Risks: new runtime network surface; configuration mistakes; misleading
“verified” UI; a diagnostic endpoint becoming an implicit authorization path.
Mitigation: admin-only, fixed endpoints, no grant, explicit non-authoritative
result, no public route.

### 5.7 Full runtime integration is a later gate

A1–A4 from the previous proposal remain valid as a later, larger design:
configuration, explicit DID/category grants, diagnostics, monitor, enforce,
Workers. They are **GATED**, not part of the Beta minimum. Do not combine them
with this minimal flow.

## 6. Option B — G5 offline DNSSEC

G5 remains frozen. This section records what unlocking would require; it does
not change authorization.

### 6.1 Required work

- owner authorization naming profile, algorithms, anchor policy and deployment
  target;
- audited third-party DNSSEC library, pinned version, no custom validator;
- configured trust anchors and a rollover/revocation policy;
- DS delegation-chain, DNSKEY/RRSIG, canonical RRset and signer-scope checks;
- NSEC/NSEC3 authenticated denial;
- wildcard processing;
- algorithms 8, 13, 15 and DS digest type 2;
- signature validity, clock and replay/rollback semantics;
- decoded-byte, RRset, key, signature and work limits;
- positive/negative/replay vectors and independent review;
- Node/Workers support matrix; Workers is not assumed.

### 6.2 Dependencies and risks

Dependencies: audited library, trust-anchor operations, DNSSEC test corpus,
external reviewer. Risks: validator bugs can turn a bogus chain into a trusted
identity; anchor rollover can break resolution; offline data can be valid but
stale/replayed; platform support is uncertain.

Effort: **8–12+ weeks** plus audit, with high uncertainty. G5 is not on the Beta
critical path. If the owner wants progress, authorize a bounded feasibility
study (library candidates, threat model, anchor policy, vector gaps), not a
validator implementation.

## 7. Option C — Nuvid contract minimum

Nuvid is an external compiler/SDK, not part of this repository. This proposal
does not design or implement it.

The minimum contract Nuvid would need to generate a **verifiable** Proof Package:

### 7.1 Inputs

- subject `did:apw:<domain>`;
- profile `apw-identity-proof-v1` first;
- bootstrap profile `independent-doh-ad-v1` first;
- original signed APW artifacts: DID document with public keys only, manifest
  JWS, full history entries, key-set binding JWS;
- consumer/operator trust configuration supplied out-of-band, never chosen by
  the package;
- no private keys, no unsigned key list, no Index-nominated trust anchor.

### 7.2 Output contract

- exact `ltp-proof-package` fields and closed schema;
- RFC 8785/JCS bytes, SHA-256/base64url digests;
- original compact JWS bytes preserved, never reserialized;
- package digest and stable target digest;
- `assembledAt`/`expiresAt` as declared bounds, not proof of observation;
- no `verified`, `score`, grant or public-distribution field that bypasses
  verification.

### 7.3 Validation contract

- identity root independently obtained by the verifier;
- subject DID/key/manifest/TXT bindings agree;
- full history, key windows, key-set binding and terminal hash are complete;
- no duplicate/unknown fields, no noncanonical payloads, no private key members;
- no arbitrary URL fetch during offline verification;
- unsupported profile/algorithm fails closed.

### 7.4 Conformance assets

- versioned schema and package examples;
- positive and negative vectors, including root substitution, bad signature,
  key-window substitution, incomplete history, duplicate dimensions if a
  calculation profile is later added;
- a language-neutral conformance runner;
- stable error/result envelope;
- explicit license boundary for an external adapter.

### 7.5 Non-goals

- Nuvid does not invent evidence or signatures.
- Nuvid does not compute G4 or claim reputation.
- Nuvid does not choose trust anchors.
- A hosted Portaless bridge API is out of scope for the Beta.
- Site-log/reader-conduct profiles are later; identity-only is the first
  contract.

C1 (docs/schema/vectors) can run in parallel with Beta work. C2 (builder CLI)
is later. C3 (hosted bridge) is out of scope.

## 8. NOW / NEXT / GATED / OUT OF SCOPE

### NOW — required to reach the official Beta

| Task | Evidence today | Dependency | Acceptance | Exit condition |
|---|---|---|---|---|
| External publisher test | No external operator recorded; Phase 5 open | One non-author operator, fresh domain, docs only | Installs, sets up, creates APW identity, publishes, provides logs/screenshots | Completed without maintainer instructions |
| Independent Index/verifier test | Inter-node sync shipped; no external Index peer | Second operator/Index node | Publisher appears in non-author Index; third party verifies | Recorded entry + verification output |
| Fix onboarding blockers found | `first-steps.md` says GitHub Pages publish still uses terminal; OAuth “coming soon” | External test findings | Each blocker either fixed or documented as a narrowed product claim | No silent blocker remains |
| Real GitHub publish | Adapter mock-tested; `not_run` | Real account/repo | Approved public projection published; rollback/unpublish recorded | External evidence row updated |
| Decide ChatGPT/product-story scope | `blocked_unverified` | Owner decision on three-free-account claim | Either real acceptance run or honest narrowing | No unverified claim in Beta story |
| Independent human review | Pending | Reviewer outside implementation | Full release diff reviewed | Evidence recorded |
| G4 closure documentation | Merge `7334e95`; register still says “final review” | Owner-approved doc update | Register and pinned prose updated | Separate governance commit, not this proposal |

### NEXT — valuable, not Beta-blocking

| Task | Evidence today | Dependency | Acceptance | Exit condition |
|---|---|---|---|---|
| Minimal LTP admin verification | G2/G3 library tests; no runtime import | Owner authorization for A-minimal | Admin-only verify flow with D7 limits and failure tests | Controlled live test + no public behavior change |
| Nuvid C1 contract/vectors | Draft package schema; no builder | Owner decision on external contract | External implementer can generate and verify an identity-only package | Independent conformance pass |
| 3–5 onboarding sessions | Roadmap target | Real people | Adjustments from sessions | Roadmap Phase 5 item 3 satisfied |

### GATED — do not start now

| Task | Why gated | Unlock condition |
|---|---|---|
| Middleware identity enforcement | Changes public bot behavior and needs grants/rollout | Owner D1–D6 + monitor evidence + bounded route list |
| Workers LTP path | No pinned DNS/egress; new trust boundary | Separate adapter/relay decision + SSRF/TLS/replay tests |
| G5 offline DNSSEC | High-risk validator, not Beta-critical | Explicit G5 authorization + audited library + vectors/review |
| Real-emitter reputation | No real emitters; G4 static only | Real distinct emitters + independent evidence |
| Cross-instance quotas | Per-process today; no shared counter | Durable Object/external counter decision + measurements |
| Public federation fan-out | No real peers; no public endpoint | Real peers publishing signed pages |
| Signed SVRI/HSVR profile | G4 unsigned/static only | Separate schema, vectors, owner decision |

### OUT OF SCOPE — do not build

- Nuvid compiler itself.
- Hosted Nuvid bridge API.
- G4 as an authorization/reputation authority.
- Global consensus or a universal Index.
- A custom DNSSEC validator.
- Cloudum verification by this repository.

## 9. External adoption test design

This is the only test that can close the official Beta exit fact. It is not a
unit test and cannot be replaced by one.

### 9.1 Participants

- **P1 — publisher:** a person outside the project, using their own domain.
- **P2 — independent Index/verifier:** a second operator running an Index node
  that is not the author's, or a distinct independent verifier plus an Index
  node operated by P2.
- **Maintainer:** observer only. May answer “where is the documentation?” but
  must not issue commands or edit P1/P2 systems.

### 9.2 Preconditions

- Fresh machine/VM with Docker (and the documented supported runtime).
- A test domain controlled by P1, not the author's.
- P2 has an independent Index instance and can configure discovery/sync.
- Both use the repository documentation and release artifact; no private
  maintainer branch, no ad-hoc instructions.

### 9.3 Steps

1. P1 installs Portaless using only the documented path.
2. P1 completes setup and creates a page.
3. P1 generates `did:apw`, publishes the required TXT record at their DNS
   provider, and verifies the identity.
4. P1 publishes an approved public page/projection.
5. P2 configures their Index node to discover/sync P1's site.
6. P2 verifies P1's APW identity with the documented resolver/verification
   surface.
7. P2 records the Index entry and verification result.
8. P1 records the public URL and the public revision/evidence output.

### 9.4 Evidence to record

- participant identities/roles, date/time, OS, Docker/Node version;
- repository commit/tag and artifact used;
- domain and public URL (non-secret);
- exact documentation paths followed;
- screenshots/logs of setup, identity verification, publication and Index
  result;
- P2's Index node identity and verification output;
- every point where documentation was insufficient or a maintainer had to
  intervene;
- final result: pass/fail and remediation owner.

### 9.5 Pass / fail

**Pass:** P1 completes all steps without maintainer instructions, P2's Index
shows the site, and P2 verifies the APW identity. No manual repository edit or
private branch is required.

**Fail:** any undocumented step, maintainer command, missing public endpoint,
failed Index discovery, or verification that depends on the author's node.
Failures become NOW tasks; do not relabel them as “known limitations” if they
block the documented flow.

The roadmap's 3–5 non-technical onboarding sessions remain a separate quality
target; this minimum test is the Beta exit fact.

## 10. Recommendation and decision request

**Single recommendation:** prioritize the external adoption test and the
product-story decisions before authorizing any LTP runtime integration.

Recommended sequence:

1. **NOW:** run the P1/P2 external adoption test; fix/document the blockers.
2. **NOW:** decide whether the three-free-account/ChatGPT/Cloudum claims are
   Beta requirements or narrowed product claims.
3. **NEXT:** if LTP Stack MVP requires Proof Package verification, authorize
   the admin-only Node flow in §5; otherwise leave G2/G3/G4 decoupled.
4. **NEXT:** authorize Nuvid C1 contract/vectors only.
5. **GATED:** middleware enforcement, Workers, G5, real-emitter reputation,
   cross-instance quotas.
6. **OUT OF SCOPE:** Nuvid compiler/hosted bridge, G4 enforcement, global Index.

### Owner decision

Choose one:

- **Beta-first (recommended):** external adoption + release-story decisions;
  LTP runtime remains decoupled.
- **Beta + minimal LTP:** add the admin-only Node verification flow.
- **LTP-first:** prioritize A-minimal before external adoption (higher risk to
  Beta timing).
- **G5 feasibility only:** study, no validator implementation.
- **Nuvid C1 only:** contract/vectors, no runtime bridge.
- **No change:** keep all gates and current scope.

This document does not change G4 or G5. G5 remains frozen. Runtime integration
does not authorize G5, and G5 does not authorize runtime integration.
