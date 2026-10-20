# MVP acceptance contract: private node, AI editing and public publishing

**Status: accepted product requirements; implementation is not implied.** This
contract translates the owner's MVP decisions into verifiable behavior. The
current source-of-truth status remains [`ROADMAP.md`](../../ROADMAP.md). A
requirement marked `BLOCKED` must not be advertised as shipped.

## 1. Product boundary

The MVP has three separate systems:

1. **Canonical node** — one active private writer, running either on the
   owner's machine or as a private Cloudum Docker deployment.
2. **Public Git projection** — a separate repository/target containing only
   approved public output and public revision evidence. GitHub Pages,
   Cloudflare Pages, or another Git-based static host serves this projection;
   it does not host the canonical DB, admin secrets or the private archive.
3. **AI client/provider** — ChatGPT is the first client target. OpenAI API-key
   compatible model endpoints are a separate provider contract, not an alias
   for ChatGPT MCP connectivity.

The local and Cloudum deployments implement the same node contract. Only one
may accept writes at a time. The second copy is a backup/restore target, not a
concurrent writer. Cloudum is an external hosting/operations service; Portaless
Core cannot claim that a host operator is unable to read an attached volume.

## 2. Data classes and permitted flows

| Class | Examples | Canonical node | AI context | Public projection |
|---|---|---:|---|---:|
| **Secret** | Admin passwords, provider tokens, private signing/decryption keys | Stored/used by server-side operations | Never returned as a value to the model | Never |
| **Private archive** | `.airchive/`, confidential documentation, personal notes | Private; access controlled | Deny by default; owner must select/authorize specific material for a task | Never, unless the owner creates a separate public derivative and approves it |
| **Draft** | Future posts, unapproved revisions | Private | Read/edit only according to granted capability | Never |
| **Approved public revision** | A page or asset explicitly approved for publication | Canonical revision remains in node | May be read by a granted agent | Yes, as a generated projection |
| **Public evidence** | Hash/revision ID, publication time, scoring-rule version and verifiable observations | Retained with the revision | Readable under normal permissions | Yes, when evidence itself is public and contains no private source data |

### Required privacy behavior

- A draft/private record returns no public content at its guessed URL; the
  response must not reveal its title, existence, body, metadata, translation,
  search snippet, sitemap entry, feed entry or cached static fallback.
- Admin preview is a separate authenticated/authorized path and is not reused
  as the public route.
- The public exporter uses an explicit allowlist of approved revisions and
  builds into a clean staging directory. It does not copy the canonical repo,
  `.airchive/`, SQLite files, backups, `.env`, provider credentials, private
  commit messages or the canonical `.git` directory.
- Public Git history contains only public projection content. A private
  canonical repository may version non-secret private documents, but raw
  credentials and private keys are not Git content, even in a private repo.
- The model never receives admin credentials or raw signing keys. It receives
  private document excerpts only after an explicit, scoped owner authorization;
  sending those excerpts to a hosted model is an external disclosure and must
  be surfaced to the owner.
- Once public output has been fetched by a third party, a later unpublish cannot
  guarantee erasure of that third-party copy. Portaless must state this at
  publication time.

## 3. Canonical history, projections and reputation

- Every publication has a stable publication ID and a content revision/hash.
- Publishing creates or selects an immutable public revision; editing creates
  another revision and does not mutate the evidence attached to earlier ones.
- Public Git history records the public projection only. The public site serves
  a generated revision/evidence manifest; it never exposes `.git` as a network
  directory.
- A reputation observation is associated with the exact revision hash, time,
  source, sample/weight information and scoring-rule version. Missing evidence
  is `no data`, not a fabricated neutral score.
- A diff can explain what changed; Portaless does not claim that a content
  change caused a reputation change unless the evidence supports causality.
- Moving between publishers must preserve stable publication IDs and verifiable
  revision/evidence records. The public Git repository alone is not a signed
  identity or proof of authorship.

The initial manifest is `portaless-public-revision-history/v1` and is unsigned.
It exports approved PageStore revisions, their content hashes and changed paths;
the admin import preserves public IDs and timestamps after hash validation. It
is not APW normative data, not proof of authorship, and not a tamper-proof
ledger. Page-specific reputation evidence remains `no_data`: current APW
observations are about the site DID, not a content revision. See
[`architecture/public-revision-history.md`](../architecture/public-revision-history.md).

## 4. Hosting, restore and resource budget

### Hosting modes

| Mode | Required behavior | Current verification |
|---|---|---|
| Local private node | Docker/Node, private canonical data, Git, MCP and public exporter | Docker/self-host paths exist; the end-to-end private-node-to-public-projection flow is not verified as terminal-less |
| Cloudum private node | Same Portaless node contract in a private Docker deployment, with private network access | Cloudum service, its access controls, backups and operator threat model are external and not verified by this repository |
| GitHub Pages | Serve only static public projection; no functions, DB, admin or MCP runtime | Static deployment exists; it cannot itself be the private node |
| Cloudflare Pages | Serve static output and optionally run Functions/D1 | Functions/D1 paths exist; parity with local private-node semantics and the complete MVP flow remain to be verified |

### Restore/handover acceptance

1. Quiesce writes on the old node and identify the last committed canonical
   revision.
2. Back up the canonical DB, private archive and required Git history. Back up
   secrets separately from public projection artifacts.
3. Restore to the target mode and verify DB/schema compatibility, content hashes,
   access controls and secret availability without printing secret values.
4. Activate the target as the sole writer; keep the previous node read-only or
   offline until rollback is no longer needed.
5. Publish a test projection and compare its public manifest/revision with the
   expected canonical revision.

### Resource acceptance

- **Budget target:** at most 20 GB of persistent node storage and 2 GiB peak
  memory during the documented MVP workload, including Git history, DB,
  required build/cache state and the defined backup policy.
- Measurement must identify the workload, dataset size/count, runtime, OS/CPU
  architecture, whether dependencies/build caches are included, peak RSS/cgroup
  memory and on-disk usage before/after a build, update, backup and restore.
- The workload fixture and exact inclusion rules are **not yet specified**;
  therefore these numbers are targets, not verified capacity guarantees.
- “Any OS” means an OS that can run the declared supported container runtime,
  not every native Node/platform combination. Initial acceptance matrix:
  Linux Docker Engine; macOS Docker Desktop; Windows 11 with WSL2/Docker Desktop.
  Each row remains unverified until CI or a reproducible manual run records OS,
  architecture, runtime version and results. Native installs outside that
  matrix are not promised by the MVP.

## 5. AI and OpenAI compatibility contract

### ChatGPT custom MCP — first client target

- Server connection is MCP Streamable HTTP over HTTPS or a supported private
  tunnel. A loopback-only `127.0.0.1` server is not directly reachable by a
  hosted ChatGPT service without such a connection mechanism.
- Test the exact intended ChatGPT account/workspace and client. Current OpenAI
  help/developer documentation describes custom MCP connections and account or
  workspace availability constraints; do not promise that a free ChatGPT
  account can use write-capable custom MCP until a real acceptance run confirms
  it. **Free-account write compatibility is a release blocker if the three-free
  account story remains a requirement.**
- The acceptance flow must verify tool discovery, authentication, revocation,
  tool-call confirmation, draft creation, editing, approval, publication and
  follow-up reads. ChatGPT may cache a snapshot of tool definitions; document
  the refresh/update step.
- A remote AI provider can receive anything deliberately placed in its context.
  Tool permissions prevent unauthorized server operations; they cannot make a
  hosted model forget data already sent to it.

### OpenAI API-compatible model provider

This is a separate provider profile using a user-supplied API key and configured
base URL/model. “100% compatible” is not an implementable acceptance statement
without naming endpoints and capabilities. Initial contract is the explicit
subset used by Portaless: authentication, model selection, request/response
shape, streaming behavior if used, tool/function calling if used, errors,
timeouts and cancellation. The key is held server-side and never sent to browser
code or MCP tool output. Each provider is marked supported only after the same
contract suite passes against a real compatible endpoint.

An OpenAI API key is not the same credential or connection as a ChatGPT account
plugin/MCP connection; API billing and product availability are separate.

## 6. One-row mobile navigation contract

- At 320 CSS px, the public header occupies one row, has no dropdown, no
  horizontal document overflow and no overlapping controls.
- Every remaining interactive control has a hit target of at least 44×44 CSS
  px. The 44 px target is an explicit Portaless product requirement (WCAG 2.1
  2.5.5 is AAA; WCAG 2.1 AA 2.5.8 is a later criterion and must not be
  mislabelled).
- The 44 px target plus 320 px viewport does not permit every desktop action to
  remain in the header. Mobile header inventory for the MVP is: brand/home,
  Publications when available, Explore, language switch when available, and
  Share. The brand/home is one control. TrustScore and context-specific actions
  remain accessible from the page/footer, not as additional header controls.
- No target is made smaller to force-fit. If measured rendered text, borders or
  gaps cause overflow, reduce spacing/wordmark presentation while preserving
  44×44 targets and re-test. If the selected inventory still cannot fit, do not
  silently wrap or clip: revise the inventory and record the decision.
- Acceptance includes `/docs/first-steps/` at 320×480, not just the home page,
  plus translated pages and pages with optional navigation items.

## 7. Release gate

The expanded MVP is not complete until all are evidenced:

- [ ] Public routes/builds do not return drafts or private/archive markers.
- [ ] Local and Cloudum modes satisfy the same canonical-node contract.
- [ ] Git publication exports only approved public projection files.
- [ ] Restore/handover completes without data loss and with one active writer.
- [ ] ChatGPT MCP write flow passes on the declared client/account plan, or the
      product story is narrowed honestly.
- [ ] API-key provider compatibility matrix is named and tested.
- [ ] One-row 320×480 layout passes without reducing targets.
- [ ] 20 GB/2 GiB budget is measured against a named workload.
- [ ] Private backups, archives and secret handling are documented and tested.

## Evidence and related documents

- Current code: [`deployment-engine.md`](../architecture/deployment-engine.md),
  [`mcp-agents.md`](../architecture/mcp-agents.md),
  [`self-hosting.md`](../self-hosting.md),
  [`DEPLOY_GITHUB_PAGES.md`](../DEPLOY_GITHUB_PAGES.md),
  [`DEPLOY_CLOUDFLARE_PAGES.md`](../DEPLOY_CLOUDFLARE_PAGES.md).
- External ChatGPT MCP requirements:
  [OpenAI developer guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt),
  [OpenAI Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta).
- Current repository claims remain governed by [`ROADMAP.md`](../../ROADMAP.md),
  not by this acceptance contract.
