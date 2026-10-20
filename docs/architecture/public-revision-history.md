# Public revision history

**Status: initial implementation shipped in Portaless; this is not an APW
normative format.** The feature covers pages owned by the current node. It does
not create a global ranking, a cross-node reputation network, or a claim of
authorship/tamper-proof storage.

## Identity and write rules

- `publicationId` is a UUID created once per publication and retained in the
  PageStore. A page revision has its own UUID `revisionId`, a monotonically
  increasing `revisionNo`, the previous canonical revision ID, and a SHA-256
  `contentHash`.
- The content hash is `sha256:` followed by the digest of JSON with recursively
  sorted object keys over an explicit allowlist: version, slug, title,
  description, locale, layoutVersion, theme and root. Publication/revision
  metadata, publication status and unknown top-level private metadata are
  excluded. This is Portaless's internal
  deterministic hash contract, not RFC 8785/JCS and not an APW signed artifact.
- `page_revisions` is append-only in application code and protected against
  SQL `UPDATE`/`DELETE` by SQLite triggers. `pages` remains the mutable current
  head. Private and draft snapshots stay only in the canonical database.
- Admin `PUT /admin/pages/:slug` requires `If-Match: "<revisionId>"` for an
  existing page or `If-None-Match: *` for a new page. A stale write gets `409`
  `revision_conflict`; an omitted precondition gets `428`. The editor and page
  manager retain the ETag from the read.
- Old rows are adopted when read. Their existing `updated_at` is used as the
  initial timestamp; the record is explicitly marked `legacy_publication` as
  the approval source rather than inventing a new approval time.

## Public projection and portability

- `GET /revisions/<publicationId>/index.json` returns only snapshots with an
  approval timestamp. It contains the publication ID, public revision IDs,
  content hashes, timestamps, approved-to-approved parent links, layouts and
  a deterministic list of changed JSON paths. Private intervening revisions
  and admin usernames are omitted.
- The static Git publisher exports the same allowlisted history for currently
  published PageStore pages to `dist/revisions/<publicationId>/index.json` and
  uses it to render a revision timeline on the page. Draft/private page layouts
  and their revisions are not copied into the public projection.
- `POST /admin/api/revisions/import` accepts this public JSON, validates every
  content hash and chain pointer, and imports the original publication/revision
  IDs and timestamps. It refuses to overwrite an existing publication. An
  imported node can then append a new revision whose parent is the latest
  imported revision.
- The public JSON can be inspected and hash-checked, but it is unsigned. Git
  history is not proof of authorship, and a publisher capable of replacing the
  projection can replace its manifest too. Do not describe this as an immutable
  public ledger.

## Reputation evidence and APW boundary

The current SiteTrustScore/APW observations are site-level; their subject is
the site's `did:apw`, not one of its content revisions. They cannot honestly be
attached to a page revision. Consequently, every revision currently reports
`reputation.status = "no_data"` and an empty observations list. No site-level
score, neutral default, or later evaluation is copied into an old revision.

The append-only `page_revision_evidence` store is keyed by the exact
`revisionId` and retains `observedAt`, `recordedAt`, `source`, `rulesVersion`,
optional sample/weight, calculation data and a proof reference. The internal
PageStore method rejects evidence for a non-public revision. Import/export
preserves these records; recording one never updates or replaces an earlier
observation. There is deliberately no public evidence-ingestion endpoint yet:
the node has no first-party source that can supply a page-specific observation.
The `proof` field is provenance data, not independently verified by this
storage layer; a source-specific verifier is required before treating it as
cryptographic proof.

APW v1.3's signed attestations and chained log remain unchanged. The public
revision projection is a Portaless-owned format and does not claim normative
APW interoperability. A future revision-bound evidence extension needs a real
source that identifies the exact content hash, observation time, source/sample,
and calculation-rule version before it can publish a score.
