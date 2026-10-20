// Persistencia real de paginas para Cloudflare D1 (server-side).
// Implementa la MISMA interfaz PageStore ya definida en
// packages/atomic-elements/src/persistence/page-store.ts (load/save/list),
// para que endpoints como functions/admin/pages/[slug].js puedan usar esta
// implementacion o LocalStoragePageStore de forma intercambiable.
// Mismo patron que packages/permissions/src/stores/d1-permission-store.ts.

import type { PageLayout } from "../../types";
import type { ResolvedCatalog } from "../../elements/element-pack";
import type { PageRevisionEvidence, PageRevisionMetadata, PageSaveOptions, PageStore, PublicPageRevision } from "../page-store";
import { validatePageLayout } from "../page-schema";
import { buildPageRevision, newRevisionIdentity, pageContentHash, validateRevisionEvidence } from "../revision-history";
import { validatePortablePublicRevisionHistory } from "../public-revision-history";

interface PageRow {
  slug: string;
  layout_json: string;
  updated_at: string;
  updated_by: string | null;
  publication_id: string | null;
  revision_id: string | null;
  revision_no: number | null;
  content_hash: string | null;
}

export class D1PageStore implements PageStore {
  private catalog?: ResolvedCatalog;

  constructor(private readonly db: D1Database) {}

  setCatalog(catalog: ResolvedCatalog): void {
    this.catalog = catalog;
  }

  async load(slug: string): Promise<PageLayout | null> {
    await this.ensureLegacyRevision(slug);
    const row = await this.db
      .prepare("SELECT * FROM pages WHERE slug = ?")
      .bind(slug)
      .first<PageRow>();
    if (!row) return null;
    return {
      ...(JSON.parse(row.layout_json) as PageLayout),
      publicationId: row.publication_id ?? undefined,
      revisionId: row.revision_id ?? undefined,
      revisionNo: row.revision_no ?? undefined,
      contentHash: row.content_hash ?? undefined,
    };
  }

  async save(layout: PageLayout, options: PageSaveOptions = {}): Promise<PageRevisionMetadata> {
    const result = validatePageLayout(layout, this.catalog);
    if (!result.valid) {
      throw new Error("Layout inv\u00e1lido: " + result.errors.join("; "));
    }
    const current = await this.load(layout.slug);
    const expected = Object.hasOwn(options, "expectedRevisionId") ? options.expectedRevisionId : layout.revisionId;
    if (current && (!expected || expected !== current.revisionId)) throw new Error("revision_conflict");
    if (!current && expected != null) throw new Error("revision_conflict");
    const built = await buildPageRevision(layout, current, options.actor ?? null);
    const { metadata, layout: revisedLayout } = built;
    const serialized = JSON.stringify(revisedLayout);
    const results = current
      ? await this.db.batch([
          this.db.prepare(`UPDATE pages SET layout_json=?, updated_at=?, updated_by=?, publication_id=?, revision_id=?, revision_no=?, content_hash=?
            WHERE slug=? AND revision_id=?`)
            .bind(serialized, metadata.createdAt, options.actor ?? null, metadata.publicationId, metadata.revisionId,
              metadata.revisionNo, metadata.contentHash, layout.slug, current.revisionId),
          this.db.prepare(`INSERT INTO page_revisions
            (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM pages WHERE slug=? AND revision_id=?)`)
            .bind(metadata.revisionId, metadata.publicationId, layout.slug, metadata.revisionNo, metadata.parentRevisionId,
              metadata.contentHash, serialized, metadata.createdAt, options.actor ?? null, metadata.approvedAt,
              metadata.approvedBy, layout.slug, metadata.revisionId),
        ])
      : await this.db.batch([
          this.db.prepare(`INSERT INTO pages (slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(layout.slug, serialized, metadata.createdAt, options.actor ?? null, metadata.publicationId,
              metadata.revisionId, metadata.revisionNo, metadata.contentHash),
          this.db.prepare(`INSERT INTO page_revisions
            (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM pages WHERE slug=? AND revision_id=?)`)
            .bind(metadata.revisionId, metadata.publicationId, layout.slug, metadata.revisionNo, metadata.parentRevisionId,
              metadata.contentHash, serialized, metadata.createdAt, options.actor ?? null, metadata.approvedAt,
              metadata.approvedBy, layout.slug, metadata.revisionId),
        ]);
    if (!results?.[0]?.meta?.changes) throw new Error("revision_conflict");
    return metadata;
  }

  async list(): Promise<string[]> {
    const { results } = await this.db.prepare("SELECT slug FROM pages").all<{ slug: string }>();
    return (results ?? []).map((r) => r.slug);
  }

  async remove(slug: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM pages WHERE slug = ?").bind(slug).run();
    return (result?.meta?.changes ?? 0) > 0;
  }

  async listPublicRevisions(slug: string): Promise<PublicPageRevision[]> {
    await this.ensureLegacyRevision(slug);
    const { results } = await this.db.prepare(`SELECT * FROM page_revisions
      WHERE slug = ? AND approved_at IS NOT NULL ORDER BY revision_no DESC`).bind(slug).all<any>();
    return this.publicRevisionRows(results ?? []);
  }

  async listPublicRevisionsByPublicationId(publicationId: string): Promise<PublicPageRevision[]> {
    const { results } = await this.db.prepare(`SELECT * FROM page_revisions
      WHERE publication_id = ? AND approved_at IS NOT NULL ORDER BY revision_no DESC`).bind(publicationId).all<any>();
    return this.publicRevisionRows(results ?? []);
  }

  async importPublicRevisionHistory(input: unknown): Promise<PageLayout> {
    const history = await validatePortablePublicRevisionHistory(input);
    for (const revision of history.revisions) {
      const validation = validatePageLayout(revision.layout, this.catalog);
      if (!validation.valid) throw new Error(`invalid_revision_layout:${validation.errors.join(";")}`);
    }
    const latest = history.revisions[0];
    const pageExists = await this.db.prepare("SELECT 1 AS hit FROM pages WHERE slug=?").bind(history.slug).first();
    const publicationExists = await this.db.prepare("SELECT 1 AS hit FROM page_revisions WHERE publication_id=? LIMIT 1").bind(history.publicationId).first();
    if (pageExists || publicationExists) throw new Error("publication_already_exists");
    const statements = [
      this.db.prepare(`INSERT INTO pages
        (slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`)
        .bind(history.slug, JSON.stringify(latest.layout), latest.createdAt, history.publicationId,
          latest.revisionId, latest.revisionNo, latest.contentHash),
      ...[...history.revisions].reverse().flatMap((revision) => [
        this.db.prepare(`INSERT INTO page_revisions
          (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`)
          .bind(revision.revisionId, history.publicationId, history.slug, revision.revisionNo,
            revision.parentRevisionId, revision.contentHash, JSON.stringify(revision.layout),
            revision.createdAt, revision.publishedAt),
        ...revision.reputation.observations.map((evidence) => this.evidenceInsertStatement(evidence)),
      ]),
    ];
    await this.db.batch(statements);
    return latest.layout;
  }

  async recordPublicRevisionEvidence(evidence: PageRevisionEvidence): Promise<void> {
    validateRevisionEvidence(evidence);
    const revision = await this.db.prepare("SELECT approved_at FROM page_revisions WHERE revision_id=?").bind(evidence.revisionId).first<{ approved_at: string | null }>();
    if (!revision?.approved_at) throw new Error("revision_not_public");
    await this.evidenceInsertStatement(evidence).run();
  }

  private async publicRevisionRows(rows: any[]): Promise<PublicPageRevision[]> {
    return Promise.all(rows.map(async (row: any, index: number) => {
      const layout = JSON.parse(row.layout_json) as PageLayout;
      return {
        publicationId: row.publication_id,
        revisionId: row.revision_id,
        revisionNo: Number(row.revision_no),
        contentHash: row.content_hash,
        // Publish only the nearest preceding approved revision, not a pointer
        // to a private or draft revision in the canonical database.
        parentRevisionId: rows[index + 1]?.revision_id ?? null,
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        slug: row.slug,
        title: layout.title,
        layout,
        evidence: await this.evidenceFor(row.revision_id),
      };
    }));
  }

  private async evidenceFor(revisionId: string): Promise<PageRevisionEvidence[]> {
    const { results } = await this.db.prepare(`SELECT * FROM page_revision_evidence
      WHERE revision_id=? ORDER BY observed_at, evidence_id`).bind(revisionId).all<any>();
    return (results ?? []).map((row: any) => ({
      evidenceId: row.evidence_id,
      revisionId: row.revision_id,
      observedAt: row.observed_at,
      recordedAt: row.recorded_at,
      source: row.source,
      rulesVersion: row.rules_version,
      sampleSize: row.sample_size === null ? null : Number(row.sample_size),
      weight: row.weight === null ? null : Number(row.weight),
      calculation: JSON.parse(row.calculation_json),
      proof: row.proof_json ? JSON.parse(row.proof_json) : null,
    }));
  }

  private evidenceInsertStatement(evidence: PageRevisionEvidence) {
    return this.db.prepare(`INSERT INTO page_revision_evidence
      (evidence_id, revision_id, observed_at, source, rules_version, sample_size, weight, calculation_json, proof_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(evidence.evidenceId, evidence.revisionId, evidence.observedAt, evidence.source, evidence.rulesVersion,
        evidence.sampleSize, evidence.weight, JSON.stringify(evidence.calculation),
        evidence.proof === null ? null : JSON.stringify(evidence.proof), evidence.recordedAt);
  }

  private async ensureLegacyRevision(slug: string): Promise<void> {
    const row = await this.db.prepare("SELECT * FROM pages WHERE slug = ?").bind(slug).first<PageRow>();
    if (!row || row.revision_id) return;
    const layout = JSON.parse(row.layout_json) as PageLayout;
    const publicationId = row.publication_id ?? newRevisionIdentity();
    const revisionId = newRevisionIdentity();
    const revisionNo = row.revision_no ?? 1;
    const contentHash = row.content_hash ?? await pageContentHash(layout);
    const legacyLayout: PageLayout = { ...layout, publicationId, revisionId, revisionNo, contentHash };
    const publicLegacy = !slug.endsWith("-draft") && (layout.status === undefined || layout.status === "published");
    const approvedAt = publicLegacy ? row.updated_at : null;
    const serialized = JSON.stringify(legacyLayout);
    await this.db.batch([
      this.db.prepare(`INSERT INTO page_revisions
        (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
        SELECT ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?
        WHERE EXISTS (SELECT 1 FROM pages WHERE slug=? AND revision_id IS NULL)`)
        .bind(revisionId, publicationId, slug, revisionNo, contentHash, serialized, row.updated_at,
          approvedAt, publicLegacy ? "legacy_publication" : null, slug),
      this.db.prepare(`UPDATE pages SET layout_json=?, publication_id=?, revision_id=?, revision_no=?, content_hash=?
        WHERE slug=? AND revision_id IS NULL`)
        .bind(serialized, publicationId, revisionId, revisionNo, contentHash, slug),
    ]);
  }
}
