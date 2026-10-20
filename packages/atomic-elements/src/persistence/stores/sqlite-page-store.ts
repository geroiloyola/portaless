// Persistencia real de paginas para self-hosted, server-side.
// Implementa la MISMA interfaz PageStore ya definida en
// packages/atomic-elements/src/persistence/page-store.ts (load/save/list).
//
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(), mismo cambio que los stores de auth.
// Uso: const store = await SqlitePageStore.open(path);

import type { PageLayout } from "../../types";
import type { ResolvedCatalog } from "../../elements/element-pack";
import type { PageProposal, PageRevisionEvidence, PageRevisionMetadata, PageSaveOptions, PageStore, PublicPageRevision } from "../page-store";
import { validatePageLayout } from "../page-schema";
import { buildPageRevision, newRevisionIdentity, validateRevisionEvidence } from "../revision-history";
import { validatePortablePublicRevisionHistory } from "../public-revision-history";
import { openSqlite } from "../../../../sqlite-driver/src/open";
import { isPubliclyPublishable } from "../../../../deploy-engine/src/draft-filter";

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

interface RevisionRow {
  publication_id: string; revision_id: string; revision_no: number; content_hash: string;
  parent_revision_id: string | null; created_at: string; created_by: string | null;
  approved_at: string | null; approved_by: string | null; effective_approved_at?: string;
  effective_approved_by?: string | null; slug: string; layout_json: string;
}

interface EvidenceRow {
  evidence_id: string; revision_id: string; observed_at: string; recorded_at: string; source: string;
  rules_version: string; sample_size: number | null; weight: number | null; calculation_json: string; proof_json: string | null;
}

export class SqlitePageStore implements PageStore {
  private db: any;
  private catalog?: ResolvedCatalog;

  setCatalog(catalog: ResolvedCatalog): void {
    this.catalog = catalog;
  }

  static async open(dbPath: string): Promise<SqlitePageStore> {
    return new SqlitePageStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqlitePageStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqlitePageStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS pages (
      slug TEXT PRIMARY KEY,
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      publication_id TEXT,
      revision_id TEXT,
      revision_no INTEGER,
      content_hash TEXT
    );`);
    for (const [column, type] of [["publication_id", "TEXT"], ["revision_id", "TEXT"], ["revision_no", "INTEGER"], ["content_hash", "TEXT"]]) {
      const columns = this.db.prepare("SELECT name FROM pragma_table_info('pages')").all().map((row: { name: string }) => row.name);
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE pages ADD COLUMN ${column} ${type}`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS page_revisions (
      revision_id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      parent_revision_id TEXT,
      content_hash TEXT NOT NULL,
      layout_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      approved_at TEXT,
      approved_by TEXT,
      UNIQUE (publication_id, revision_no)
    );
    CREATE INDEX IF NOT EXISTS idx_page_revisions_public_history
      ON page_revisions (publication_id, approved_at, revision_no);
    CREATE TRIGGER IF NOT EXISTS page_revisions_no_update
      BEFORE UPDATE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS page_revisions_no_delete
      BEFORE DELETE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END;
    CREATE TABLE IF NOT EXISTS page_revision_evidence (
      evidence_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      sample_size INTEGER,
      weight REAL,
      calculation_json TEXT NOT NULL,
      proof_json TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_page_revision_evidence_revision
      ON page_revision_evidence (revision_id, observed_at, evidence_id);
    CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_update
      BEFORE UPDATE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_delete
      BEFORE DELETE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS page_revision_approvals (
      revision_id TEXT PRIMARY KEY, approved_at TEXT NOT NULL, approved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_page_revision_approvals_approved_at ON page_revision_approvals (approved_at, revision_id);
    CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_update
      BEFORE UPDATE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_delete
      BEFORE DELETE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END;
    INSERT OR IGNORE INTO page_revision_approvals (revision_id, approved_at, approved_by)
      SELECT revision_id, approved_at, approved_by FROM page_revisions WHERE approved_at IS NOT NULL;`);
  }

  async load(slug: string): Promise<PageLayout | null> {
    await this.ensureLegacyRevision(slug);
    const row = this.db.prepare("SELECT * FROM pages WHERE slug = ?").get(slug) as PageRow | undefined;
    if (!row) return null;
    const layout = JSON.parse(row.layout_json) as PageLayout;
    return {
      ...layout,
      publicationId: row.publication_id ?? layout.publicationId,
      revisionId: row.revision_id ?? layout.revisionId,
      revisionNo: row.revision_no ?? layout.revisionNo,
      contentHash: row.content_hash ?? layout.contentHash,
    };
  }

  async save(layout: PageLayout, options: PageSaveOptions = {}): Promise<PageRevisionMetadata> {
    const result = validatePageLayout(layout, this.catalog);
    if (!result.valid) {
      throw new Error("Layout inválido: " + result.errors.join("; "));
    }
    const current = await this.load(layout.slug);
    const expectedRevisionId = Object.hasOwn(options, "expectedRevisionId") ? options.expectedRevisionId : layout.revisionId;
    this.assertExpectedRevision(current, expectedRevisionId);
    const built = await buildPageRevision(layout, current, options.actor ?? null);
    const updatedAt = built.metadata.createdAt;
    const transaction = this.db.transaction(() => {
      const latest = this.db.prepare("SELECT revision_id FROM pages WHERE slug = ?").get(layout.slug) as { revision_id: string | null } | undefined;
      if ((latest?.revision_id ?? null) !== (current?.revisionId ?? null)) throw new Error("revision_conflict");
      const { metadata, layout: revisedLayout } = built;
      this.db.prepare(`INSERT INTO page_revisions
        (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(metadata.revisionId, metadata.publicationId, layout.slug, metadata.revisionNo,
          metadata.parentRevisionId, metadata.contentHash, JSON.stringify(revisedLayout), updatedAt,
          options.actor ?? null, metadata.approvedAt, metadata.approvedBy);
      this.db.prepare(`INSERT INTO pages
        (slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET layout_json=excluded.layout_json, updated_at=excluded.updated_at,
          updated_by=excluded.updated_by, publication_id=excluded.publication_id, revision_id=excluded.revision_id,
          revision_no=excluded.revision_no, content_hash=excluded.content_hash`)
         .run(layout.slug, JSON.stringify(revisedLayout), updatedAt, options.actor ?? null,
           metadata.publicationId, metadata.revisionId, metadata.revisionNo, metadata.contentHash);
      if (metadata.approvedAt) this.insertApproval(metadata.revisionId, metadata.approvedAt, metadata.approvedBy);
    });
    transaction();
    return built.metadata;
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare("SELECT slug FROM pages").all() as { slug: string }[];
    return rows.map((r) => r.slug);
  }

  async remove(slug: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM pages WHERE slug = ?").run(slug);
    return (result?.changes ?? 0) > 0;
  }

  async listPublicRevisions(slug: string): Promise<PublicPageRevision[]> {
    const current = await this.load(slug);
    return current?.publicationId ? this.listPublicRevisionsByPublicationId(current.publicationId) : [];
  }

  async listPublicRevisionsByPublicationId(publicationId: string): Promise<PublicPageRevision[]> {
    const rows = this.db.prepare(`SELECT r.*, a.approved_at AS effective_approved_at, a.approved_by AS effective_approved_by
      FROM page_revisions r JOIN page_revision_approvals a ON a.revision_id=r.revision_id
      WHERE r.publication_id = ? ORDER BY r.revision_no DESC`).all(publicationId) as RevisionRow[];
    return this.publicRevisionRows(rows);
  }

  async importPublicRevisionHistory(input: unknown): Promise<PageLayout> {
    const history = await validatePortablePublicRevisionHistory(input);
    for (const revision of history.revisions) {
      const validation = validatePageLayout(revision.layout, this.catalog);
      if (!validation.valid) throw new Error(`invalid_revision_layout:${validation.errors.join(";")}`);
    }
    const latest = history.revisions[0];
    const transaction = this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM pages WHERE slug=?").get(history.slug) ||
          this.db.prepare("SELECT 1 FROM page_revisions WHERE publication_id=?").get(history.publicationId)) {
        throw new Error("publication_already_exists");
      }
      for (const revision of [...history.revisions].reverse()) {
        this.db.prepare(`INSERT INTO page_revisions
          (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`)
          .run(revision.revisionId, history.publicationId, history.slug, revision.revisionNo,
            revision.parentRevisionId, revision.contentHash, JSON.stringify(revision.layout),
            revision.createdAt, revision.publishedAt);
        this.insertApproval(revision.revisionId, revision.publishedAt, null);
        for (const evidence of revision.reputation.observations) this.insertEvidence(evidence);
      }
      this.db.prepare(`INSERT INTO pages
        (slug, layout_json, updated_at, updated_by, publication_id, revision_id, revision_no, content_hash)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`)
        .run(history.slug, JSON.stringify(latest.layout), latest.createdAt, history.publicationId,
          latest.revisionId, latest.revisionNo, latest.contentHash);
    });
    transaction();
    return latest.layout;
  }

  async recordPublicRevisionEvidence(evidence: PageRevisionEvidence): Promise<void> {
    validateRevisionEvidence(evidence);
    const revision = this.db.prepare("SELECT approved_at FROM page_revision_approvals WHERE revision_id=?").get(evidence.revisionId) as { approved_at: string | null } | undefined;
    if (!revision?.approved_at) throw new Error("revision_not_public");
    this.db.transaction(() => this.insertEvidence(evidence))();
  }

  async saveProposal(layout: PageLayout, expectedBaseRevisionId: string, actor: string): Promise<PageRevisionMetadata> {
    const validation = validatePageLayout(layout, this.catalog);
    if (!validation.valid) throw new Error("invalid_page_layout:" + validation.errors.join(";"));
    const current = await this.load(layout.slug);
    if (!current || !isPubliclyPublishable(current) || current.revisionId !== expectedBaseRevisionId) throw new Error("revision_conflict");
    const pending = this.db.prepare(`SELECT 1 FROM page_revisions
      WHERE publication_id=? AND parent_revision_id=? AND approved_at IS NULL LIMIT 1`).get(current.publicationId, expectedBaseRevisionId);
    if (pending) throw new Error("revision_proposal_already_exists");
    const built = await buildPageRevision({ ...layout, status: "draft" }, current, actor);
    const metadata = { ...built.metadata, approvedAt: null, approvedBy: null };
    this.db.transaction(() => {
      const head = this.db.prepare("SELECT revision_id FROM pages WHERE slug=?").get(layout.slug) as { revision_id: string | null } | undefined;
      if (head?.revision_id !== expectedBaseRevisionId) throw new Error("revision_conflict");
      const exists = this.db.prepare(`SELECT 1 FROM page_revisions
        WHERE publication_id=? AND parent_revision_id=? AND approved_at IS NULL LIMIT 1`).get(current.publicationId, expectedBaseRevisionId);
      if (exists) throw new Error("revision_proposal_already_exists");
      this.db.prepare(`INSERT INTO page_revisions
        (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .run(metadata.revisionId, metadata.publicationId, layout.slug, metadata.revisionNo, expectedBaseRevisionId,
          metadata.contentHash, JSON.stringify(built.layout), metadata.createdAt, actor);
    })();
    return metadata;
  }

  async approveRevision(slug: string, revisionId: string, actor: string): Promise<PageRevisionMetadata> {
    const revision = this.db.prepare("SELECT * FROM page_revisions WHERE slug=? AND revision_id=?").get(slug, revisionId) as RevisionRow | undefined;
    if (!revision) throw new Error("revision_not_found");
    if (this.db.prepare("SELECT 1 FROM page_revision_approvals WHERE revision_id=?").get(revisionId)) throw new Error("revision_already_approved");
    const stored = JSON.parse(revision.layout_json) as PageLayout;
    if (stored.status !== "draft") throw new Error("revision_not_approvable");
    const validation = validatePageLayout(stored, this.catalog);
    if (!validation.valid) throw new Error("invalid_page_layout:" + validation.errors.join(";"));
    const current = await this.load(slug);
    const isCurrentDraft = current?.revisionId === revisionId;
    const isBasedOnCurrent = Boolean(revision.parent_revision_id && current?.revisionId === revision.parent_revision_id);
    if (!isCurrentDraft && !isBasedOnCurrent) throw new Error("revision_conflict");
    const approvedAt = new Date().toISOString();
    const publishedLayout: PageLayout = { ...stored, status: "published" };
    this.db.transaction(() => {
      const head = this.db.prepare("SELECT revision_id FROM pages WHERE slug=?").get(slug) as { revision_id: string | null } | undefined;
      if ((head?.revision_id ?? null) !== (current?.revisionId ?? null)) throw new Error("revision_conflict");
      if (this.db.prepare("SELECT 1 FROM page_revision_approvals WHERE revision_id=?").get(revisionId)) throw new Error("revision_already_approved");
      this.insertApproval(revisionId, approvedAt, actor);
      this.db.prepare(`UPDATE pages SET layout_json=?, updated_at=?, updated_by=?, publication_id=?, revision_id=?, revision_no=?, content_hash=?
        WHERE slug=? AND revision_id=?`)
        .run(JSON.stringify(publishedLayout), approvedAt, actor, revision.publication_id, revisionId,
          revision.revision_no, revision.content_hash, slug, current?.revisionId);
    })();
    return {
      publicationId: revision.publication_id,
      revisionId,
      revisionNo: revision.revision_no,
      contentHash: revision.content_hash,
      parentRevisionId: revision.parent_revision_id,
      createdAt: revision.created_at,
      approvedAt,
      approvedBy: actor,
    };
  }

  async listPendingRevisions(slug: string): Promise<PageProposal[]> {
    const rows = this.db.prepare(`SELECT r.* FROM page_revisions r
      LEFT JOIN page_revision_approvals a ON a.revision_id=r.revision_id
      WHERE r.slug=? AND r.parent_revision_id IS NOT NULL AND a.revision_id IS NULL ORDER BY r.revision_no DESC`).all(slug) as RevisionRow[];
    return rows.map((row) => ({
      publicationId: row.publication_id,
      revisionId: row.revision_id,
      revisionNo: row.revision_no,
      baseRevisionId: row.parent_revision_id ?? "",
      contentHash: row.content_hash,
      createdAt: row.created_at,
      createdBy: row.created_by,
      layout: JSON.parse(row.layout_json) as PageLayout,
    }));
  }

  private publicRevisionRows(rows: RevisionRow[]): PublicPageRevision[] {
    return rows.map((row, index) => {
      const layout = JSON.parse(row.layout_json) as PageLayout;
      return {
        publicationId: row.publication_id,
        revisionId: row.revision_id,
        revisionNo: row.revision_no,
        contentHash: row.content_hash,
        // Never publish the private parent pointer: bridge only to the nearest
        // preceding approved revision, if there is one.
        parentRevisionId: rows[index + 1]?.revision_id ?? null,
        createdAt: row.created_at,
        approvedAt: row.effective_approved_at ?? row.approved_at,
        slug: row.slug,
        title: layout.title,
        layout: { ...layout, status: "published" },
        evidence: this.evidenceFor(row.revision_id),
      };
    });
  }

  private evidenceFor(revisionId: string): PageRevisionEvidence[] {
    const rows = this.db.prepare(`SELECT e.* FROM page_revision_evidence e
      JOIN page_revision_approvals a ON a.revision_id=e.revision_id
      WHERE e.revision_id=? ORDER BY e.observed_at, e.evidence_id`).all(revisionId) as EvidenceRow[];
    return rows.map((row) => ({
      evidenceId: row.evidence_id,
      revisionId: row.revision_id,
      observedAt: row.observed_at,
      recordedAt: row.recorded_at,
      source: row.source,
      rulesVersion: row.rules_version,
      sampleSize: row.sample_size,
      weight: row.weight,
      calculation: JSON.parse(row.calculation_json),
      proof: row.proof_json ? JSON.parse(row.proof_json) : null,
    }));
  }

  private insertEvidence(evidence: PageRevisionEvidence): void {
    this.db.prepare(`INSERT INTO page_revision_evidence
      (evidence_id, revision_id, observed_at, source, rules_version, sample_size, weight, calculation_json, proof_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(evidence.evidenceId, evidence.revisionId, evidence.observedAt, evidence.source, evidence.rulesVersion,
        evidence.sampleSize, evidence.weight, JSON.stringify(evidence.calculation),
        evidence.proof === null ? null : JSON.stringify(evidence.proof), evidence.recordedAt);
  }

  private insertApproval(revisionId: string, approvedAt: string, approvedBy: string | null): void {
    this.db.prepare("INSERT INTO page_revision_approvals (revision_id, approved_at, approved_by) VALUES (?, ?, ?)")
      .run(revisionId, approvedAt, approvedBy);
  }

  private assertExpectedRevision(current: PageLayout | null, expected: string | null | undefined): void {
    if (current && (!expected || expected !== current.revisionId)) throw new Error("revision_conflict");
    if (!current && expected != null) throw new Error("revision_conflict");
  }

  private async ensureLegacyRevision(slug: string): Promise<void> {
    const row = this.db.prepare("SELECT * FROM pages WHERE slug = ?").get(slug) as PageRow | undefined;
    if (!row || row.revision_id) return;
    const layout = JSON.parse(row.layout_json) as PageLayout;
    const publicationId = row.publication_id ?? newRevisionIdentity();
    const revisionId = newRevisionIdentity();
    const revisionNo = row.revision_no ?? 1;
    const { pageContentHash } = await import("../revision-history");
    const contentHash = row.content_hash ?? await pageContentHash(layout);
    const legacyLayout = { ...layout, publicationId, revisionId, revisionNo, contentHash };
    const publicLegacy = isPubliclyPublishable(layout);
    const approvedAt = publicLegacy ? row.updated_at : null;
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare("SELECT revision_id FROM pages WHERE slug = ?").get(slug) as { revision_id: string | null } | undefined;
      if (!current || current.revision_id) return;
      this.db.prepare(`INSERT INTO page_revisions
        (revision_id, publication_id, slug, revision_no, parent_revision_id, content_hash, layout_json, created_at, created_by, approved_at, approved_by)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`)
        .run(revisionId, publicationId, slug, revisionNo, contentHash, JSON.stringify(legacyLayout), row.updated_at,
          approvedAt, publicLegacy ? "legacy_publication" : null);
      if (approvedAt) this.insertApproval(revisionId, approvedAt, "legacy_publication");
      this.db.prepare(`UPDATE pages SET layout_json=?, publication_id=?, revision_id=?, revision_no=?, content_hash=?
        WHERE slug=? AND revision_id IS NULL`)
        .run(JSON.stringify(legacyLayout), publicationId, revisionId, revisionNo, contentHash, slug);
    });
    transaction();
  }

  close(): void {
    this.db.close();
  }
}
