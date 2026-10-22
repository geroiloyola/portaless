# ADR 0003: Public and governed resource contract

- **Status:** Proposed for owner review; documentation only, no enforcement change
- **Decision date:** 2026-10-22
- **Scope:** Automated reads of Portaless content and projections across static,
  Cloudflare Pages Functions and the self-host Node runtime.
- **Implementation gate:** Do not advertise or enable governed content until
  the resource classification, reader identity/reputation profile and dynamic
  serving path in this contract have tests and an owner-approved policy.

## Summary

Portaless distinguishes **publication state** from **read-access class**:

- **Publication state** answers whether a revision is approved for publication:
  `draft`, `private`, or `published`.
- **Read-access class** answers whether an approved resource is a public
  projection or requires a dynamic authorization decision: `public` or
  `governed`.

These are not interchangeable. A draft/private resource is never public. A
published `public` resource is intentionally retrievable by anyone. A published
`governed` resource is not placed in a public static projection and is served
only by a runtime that can enforce its policy. **User-Agent detection and
`robots.txt` are not confidentiality controls.**

This ADR records the proposed route contract for PR1. It does not add a schema
field, alter middleware, change current routes, or make SVRI numeric thresholds
an authorization primitive.

## Context and verified current behavior

### What the code does today

1. Astro builds with `output: "static"`. GitHub Pages serves that output with
   no Functions or request-time authorization.
2. The shared middleware applies only when the runtime has Functions. It exits
   when `ENABLE_TRUST_LAYER !== "true"`, bypasses discovery paths, lets an
   unsigned request with a non-bot-looking User-Agent through, and rejects an
   unsigned bot-looking User-Agent with `403`. A signed request is verified and
   then evaluated against `ai_input` (`allow`, `block` or `charge`). See
   `functions/_middleware.js:212-280`.
3. `isPublicBotRoute()` currently bypasses the signature/policy middleware for
   `/robots.txt`, `/llms.txt`, `/sitemap.xml`, all `/.well-known/*`, and
   `/blog/*.md`. See `packages/trust-layer/src/policy/public-bot-routes.ts:12-18`.
4. `search` and `ai_train` are emitted as cooperative Content Signals; only
   `ai_input` is request-enforced. A crawler that does not honor those signals
   is not blocked by them.
5. `/blog/<id>.md`, blog HTML, docs HTML/Markdown, RSS, sitemap, `llms.txt` and
   content pages are generated as static output. The shared publication filter
   excludes `draft`, `private`, legacy `-draft` and unknown publication states,
   but there is not yet a separate `public|governed` access class.
6. `GET /revisions/<publicationId>/index.json` is a runtime Function, and the
   publication exporter can also place approved revision histories in a static
   projection. The history contains the published layout, title and changed
   paths, not only a hash. It must therefore be treated as content-bearing.
7. `/trust/:siteId` has a separate, existing LTP reader policy. It verifies
   Web Bot Auth, resolves APW reader identity and evaluates reader dimensions
   (`R-01`, with `R-05` disabled in the current configuration). It is not a
   generic policy for page, blog or media routes.

### Current gaps this RFC records (not fixed by PR1)

- `/blog/*.md` is an unconditional public-bot exception. It passes the
  middleware even when `ai_input=block`; the generated Markdown file is also
  public on GitHub Pages. Hiding it from `llms.txt` is not sufficient.
- `robots.txt`, `llms.txt`, sitemap and `/.well-known/*` are explicit
  middleware exceptions. `/rss.xml`, public docs Markdown and other static
  content routes are not in that exception list, so a bot-like UA may get a
  runtime 403 for those routes while a static host serves the same bytes.
- `ai_input=block` removes content links from generated `llms.txt`, but does
  not remove static HTML, `.md`, RSS or revision artifacts. `charge` still
  allows links to appear in `llms.txt`; payment enforcement, when available,
  occurs on a dynamic request, not in the index.
- A request with a browser-looking or spoofed User-Agent passes the current
  middleware without Web Bot Auth. This is not a governed-resource boundary.
- `GET /revisions/:publicationId/index.json` returns published revision
  layouts under public cache headers. The exporter also creates public
  revision artifacts. Those are valid for public publications and must be
  suppressed for a future governed publication.

### Security implication

At a static host, once bytes are in the public build or public Git projection,
no middleware can recall or protect them. Even on a dynamic host, an anonymous
scraper can use a normal-looking User-Agent; the current bot heuristic is a
mitigation, not proof that a request is human. Public content must be described
as public. Confidentiality requires the governed serving path below.

## Proposed modes

### `public`

- The owner has approved the resource for public projection.
- Anyone may retrieve its public bytes without identity.
- Static HTML/Markdown and public feeds/indexes may contain it.
- `robots.txt`/Content Signals may express the owner's terms. They are
  cooperative signals, not an access-control boundary.
- On a dynamic deployment, Web Bot Auth and `ai_input` may additionally control
  recognized/identified automated requests, but that does not make a public
  resource confidential or protect a static copy.

### `governed`

- The owner has approved publication to an authorization-aware route, **not**
  anonymous publication.
- Its body, title/description where sensitive, Markdown alternate, image bytes,
  revision layout/history and other content-bearing derivatives are excluded
  from the public build, public Git projection, RSS, sitemap and `llms.txt`.
- Every direct representation is checked by the same runtime authorization
  decision. A route alias, locale variant, content negotiation path, revision
  endpoint or media endpoint must not bypass it.
- It requires a dynamic origin with an active gate. GitHub Pages cannot serve a
  governed resource. A build/export containing governed bytes is a release
  failure, not a degraded-but-acceptable mode.
- An automated reader must present valid Web Bot Auth, resolve to a verified
  `did:apw` identity, be assigned a policy category by verified/configured
  identity (not by a self-asserted header), and satisfy the owner's reader
  policy. Missing evidence never becomes an SVRI prior-as-measurement.
- Anonymous readers are denied. An authorized human-reader/session path is not
  defined by PR1; do not infer “human” from User-Agent. Until that separate
  contract exists, governed resources are available only to the owner/admin
  preview and supported authenticated reader clients.
- The public response is non-cacheable (`private, no-store`) unless a future
  authorization-aware cache contract proves that its cache key includes the
  verified identity, policy revision and evidence freshness.

### `draft` / `private`

These remain unpublished states, not a third reader policy. They do not appear
in public routes, indexes, feeds, static output or public revision history.
Admin preview remains a separate session-protected path with `no-store` and
`noindex`.

## PR1 route matrix

“Proposed treatment” below is the contract for future implementation. “Current
behavior” is evidence from the named files; it is not an assertion that the
target behavior already exists.

| Route/resource | Current implementation and exposure | Proposed PR1 classification and Gatekeeper treatment |
|---|---|---|
| `/`, `/beta/`, `/shop/`, `/explore/`, `/projections/`, system HTML pages | Astro static output. On Functions/Node, bot middleware may run; on GitHub Pages it does not. | `public` by default. Remain public and static. If an owner later marks a page governed, it must be removed from static output and served dynamically. |
| `/pages/:slug/`, `/:locale/pages/:slug/` | Content JSON is emitted by `src/pages/pages/[slug].astro` and locale routes. Runtime PageStore is handled by `functions/pages/[slug].js`; drafts/private are 404/no-store. The route family has no access-class field today. | `public` by default for existing published pages. A future `accessClass=governed` page must not be emitted by Astro/export; all locale variants use the same policy and dynamic gate. |
| `/paginas/:slug/` and other legacy aliases | Static meta-refresh for published pages; runtime 301 from `functions/_middleware.js`. | Alias inherits the target resource's class. A governed alias must reach the same Gatekeeper and must not point to a public static copy. |
| `/blog/`, `/blog/:slug/` | Static HTML from the `posts` collection filtered by `publishedPosts()`; no governed class. | `public` by default. A governed post is excluded from static paths and served only by a dynamic route under the same resource decision. |
| `/blog/:slug.md` | Static Markdown from `src/pages/blog/[...slug].md.ts`. It is explicitly in `isPublicBotRoute()` and bypasses the current Web Bot Auth/`ai_input` gate on Functions. | Public alternate only for a `public` post. For a governed post, do not generate a `.md` file; if a dynamic Markdown representation exists, it must call the same Gatekeeper as HTML. Remove unconditional route exemption or make it conditional on verified `public` classification. |
| `/llms.txt` | Static index from `src/pages/llms.txt.ts`; the Function may merge up to 200 PageStore public pages. When `ai_input=block`, build output contains a marker and the Function refuses to merge DB pages. `llms.txt` itself bypasses the current bot middleware. | Always a **public index of public resources**, never a governed content endpoint. It may advertise the policy and public links. It must omit governed slug, title, description and URL; a governed resource's identifier must not leak through the index. The index route itself remains available for discovery. |
| `/robots.txt` | Static `Content-Signal` generated by `src/pages/robots.txt.ts`; always public discovery. | Always public protocol metadata. It can state cooperative signals and policy URL; it does not authorize or deny access to bytes. It must not list governed resources. |
| `/sitemap.xml` | Static build list from `src/pages/sitemap.xml.ts`; includes static pages/posts/docs/products. It is explicitly exempted by current bot middleware. Runtime DB-owned pages are not merged. | Always public index of `public` resources only. Governed/private/draft paths are absent. The route itself is not placed behind the content Gatekeeper. |
| `/rss.xml` | Static feed from published posts in `src/pages/rss.xml.ts`; not currently in the explicit public-bot bypass list, so runtime behavior can differ by User-Agent. | Public feed of `public` posts only. Governed posts are omitted; no private data or governed titles/descriptions in feed entries. Runtime behavior must not diverge from the static projection. |
| `/docs/`, `/docs/:slug/`, `/docs/:slug.md` | Curated Markdown selected by `src/lib/docs-nav.mjs`, built as static HTML and Markdown. This is public documentation; not all repository docs are published. | `public` by default and kept on the curated allowlist. A governed document must not enter `DOC_ENTRIES`, static output, `llms.txt` or the public Git projection. A future governed-doc feature needs a separate dynamic route. |
| `/.well-known/*` (DID, APW manifest/log/attestations/index, content policy, MCP profile, usage log, etc.) | Public Functions; the whole prefix is currently exempt from the signature/policy middleware. | Public discovery/protocol metadata only. Keep it fetchable without Web Bot Auth so a reader can discover identity and policy. It must not carry governed bodies, private resource identifiers or secrets. `portaless-content-policy.json` describes policy; it does not enforce it by itself. |
| `/revisions/:publicationId/index.json` | Function returns verified public revision history, including revision layout/title/changed paths; `scripts/public-revision-export.mjs` can also place approved histories in static output. Runtime requests pass through the general bot/`ai_input` middleware, except unsigned non-bot-looking requests pass. | Public only when the associated publication is `public`. For a governed publication, omit static export and return only through the same Gatekeeper as the content; no public history containing layout/title/changed paths. No separate “metadata-only” assumption. |
| `/images/:imageId`, `/trust/images/:imageId`, `POST /trust/images/verify` | Cloud Images are public immutable bytes and public verification data in Functions; the verifier accepts a supplied sidecar and resolves remote APW evidence. These routes are subject to the shared middleware; with the Trust Layer enabled, an unsigned bot-like UA can receive `403`, while a non-bot-looking UA passes. Static hosts have no such gate. | Current Cloud Images remain `public`. A future governed image must be excluded from public object storage/URLs and verified/served through a dynamic identity-bound route; sidecar/signature verification is not authorization. |
| `/trust/:siteId` | Existing LTP read-governance route in `functions/trust/[siteId].js`: optional/required Web Bot Auth and APW reader identity according to `site_trust_read_policies`, with R-dimension predicates. | Remains governed by its existing LTP contract; it is not evidence that content routes are governed. PR1 must not replace reader R-policy with the site's W/SVRI score. |
| `/admin/preview/pages/:slug`, `/admin/*`, `/admin/api/*` | Admin session/role middleware. Preview rejects published pages, uses `private, no-store`, `noindex`, and does not fall through to static content. | Remains a separate administrative trust boundary. Do not reuse admin preview as an automated-reader gate. |

### Explicit Gatekeeper route set for a governed resource

The Gatekeeper covers every content-bearing representation of a resource,
conditionally on that resource being classified `governed`:

1. Page HTML: `/pages/:slug/` and every `/:locale/pages/:slug/` translation.
2. Blog HTML and Markdown: `/blog/:slug/` and `/blog/:slug.md`.
3. Public revision history: `/revisions/:publicationId/index.json` and any
   static `public/revisions/**` artifact.
4. Media bytes and verification metadata when that media is governed.
5. Any alias, direct API, feed, alternate format or cache key that can return
   the same governed body.

The following remain public discovery/index routes and **must filter their
contents instead of becoming the only gate**: `/llms.txt`, `/robots.txt`,
`/sitemap.xml`, `/rss.xml` and safe `/.well-known/*` metadata. A public index
must never disclose a governed resource's identifiers or descriptive metadata.

## Identity, reputation and evidence boundaries

- Web Bot Auth proves control of a key for a request. APW resolution binds that
  key to a reader identity. Neither fact alone proves good conduct.
- Existing SVRI `ltp-svri-site-v1` is a **site** reputation projection over W
  dimensions, not an automated reader score. `ltp-svri-reader-v1` declares that
  a consumer can render SVRI; it does not calculate reader trustworthiness.
- Existing reader authorization uses LTP R dimensions (`R-01`; `R-05` is
  disabled because the required outgoing-attestation corpus is absent). If a new
  numeric SVRI reader reputation is required, it needs its own versioned
  normative profile, evidence sources, missing-data rules and independent
  vectors before it can be an authorization threshold.
- A blocked request is not evidence of misconduct. Do not emit a negative
  `reader_conduct` attestation solely because a category is disabled, evidence
  is absent, DNS failed or a reader missed a local threshold.
- `did:apw:google.com` / `did:apw:openai.com` are not trusted identities merely
  because a name resembles a company. Category assignment requires verified
  ownership or explicit local configuration. A User-Agent or self-asserted
  category cannot grant a more permissive rule.
- Sybil resistance is not guaranteed by Web Bot Auth or a numeric threshold.
  Keys can be created cheaply; reputation depends on independent, verified,
  non-duplicated evidence. Do not claim that proxies become impossible or that
  T1 escrow is required unless an accepted protocol decision says so.
- Community reputation is not a global, instantly propagated blacklist. Each
  site evaluates evidence under its own reader policy; other nodes update only
  when they resolve/refresh the relevant evidence.

## Acceptance criteria for implementation PRs

1. Add a typed access-class field separate from publication state. Existing
   published resources remain `public` unless an owner explicitly reclassifies
   them; drafts/private remain absent from public projections.
2. Static export fails closed or omits all `governed` bodies and every derived
   representation. A marker fixture for a governed page/post/revision/image is
   absent from `dist/`, publication artifacts and public indexes.
3. A `governed` request is authorized by resource classification, not by
   User-Agent. An unsigned non-bot-looking request cannot fetch governed bytes.
4. All direct representations and aliases share the same authorization
   decision. Tests cover HTML, `.md`, revision history and media where supported.
5. `/llms.txt`, `/sitemap.xml`, `/rss.xml` and public metadata contain only
   `public` resources and do not leak governed identifiers or descriptions.
6. Public resources continue to work on GitHub Pages with no Functions. The
   product states plainly that static public bytes cannot be withdrawn or gated
   after deployment.
7. Web Bot Auth, APW reader identity, reputation, missing evidence, expired
   evidence, resolver outages and policy changes have explicit status/ledger
   behavior. Missing evidence is never treated as an SVRI prior-as-measurement.
8. Every decision is auditable by policy revision and reason; no rejection is
   converted automatically into a negative reputation attestation.
9. The new configuration is optional and backward-compatible. Disabling it
   cannot break current public routes; enabling governed mode requires a runtime
   that enforces it and cannot silently fall back to static bytes.

## Non-goals and claims not supported by this RFC

- This RFC does not promise that public static content can be protected from
  scraping.
- It does not make `robots.txt`/Content Signals an enforcement mechanism.
- It does not claim that a Site SVRI threshold is a reader reputation score.
- It does not create a global reputation authority or instantaneous global
  blocklist for Google, OpenAI, Anthropic or any other company.
- It does not define an authenticated public human-reader account system.
- It does not charge for identity, require an escrow deposit, or claim that
  Sybil attacks are economically impossible.

## Required owner decisions before the enforcement implementation

1. Which content owners may mark `accessClass=governed`, and whether that is
   available in the editor, the publication flow, or both.
2. Whether governed human readers are unsupported in the MVP or need a separate
   authenticated human-reader path.
3. Which verified identities/categories count as Portaless Index, external
   search or AI. Do not ship category allowlists based on UA strings.
4. Whether the existing LTP R-reader policy is sufficient for the first gate or
   whether a new SVRI reader-reputation profile is a prerequisite. A bare
   threshold `5.0` is not sufficient to decide this.
5. Whether public static publication remains the default mode and what warning
   the owner must acknowledge before publishing content they intend to govern.

## Related implementation evidence

- `functions/_middleware.js` — current Trust Layer gate and `ai_input` decision.
- `packages/trust-layer/src/policy/public-bot-routes.ts` — current unsigned
  discovery exemptions.
- `packages/deploy-engine/src/draft-filter.ts` — current publication-state
  filter; it does not yet define `public|governed`.
- `src/pages/blog/[...slug].astro`, `src/pages/blog/[...slug].md.ts` — static
  HTML/Markdown publication of posts.
- `src/pages/llms.txt.ts`, `functions/llms.txt.js` — static index and runtime
  PageStore merge.
- `src/pages/sitemap.xml.ts`, `src/pages/rss.xml.ts` — static discovery feeds.
- `functions/revisions/[publicationId]/index.json.js`,
  `scripts/public-revision-export.mjs` — runtime and static public revision
  history.
- `functions/pages/[slug].js`, `src/pages/pages/[slug].astro`,
  `src/pages/[locale]/pages/[slug].astro` — runtime and static page routes.
- `functions/trust/[siteId].js`, `packages/apw-resolver/src/scoring/policy.ts`
  — separate existing LTP reader policy.
- `docs/mvp/acceptance-contract.md` and
  `docs/architecture/canonical-node-and-public-projections.md` — accepted
  private-node/public-projection contract.
