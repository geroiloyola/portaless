// Interfaz de persistencia de paginas. El MVP usa localStorage (para poder
// probar el editor sin backend), pero cualquier sitio en produccion deberia
// implementar PageStore contra el propio repositorio Git del sitio (un
// archivo JSON por pagina en src/content/pages/), manteniendo el mismo
// principio de "todo es texto versionable" del resto de Portaless.

import type { PageLayout } from "../types";
import type { ResolvedCatalog } from "../elements/element-pack";
import { validatePageLayout } from "./page-schema";

export interface PageStore {
  load(slug: string): Promise<PageLayout | null>;
  save(layout: PageLayout, options?: PageSaveOptions): Promise<PageRevisionMetadata>;
  list(): Promise<string[]>;
  /** Elimina la pagina. true si habia algo que borrar (Phase 0.5). */
  remove(slug: string): Promise<boolean>;
  /**
   * Catalogo resuelto (core ∪ element packs) contra el cual save() valida.
   * Sin catalogo, save valida contra el core y rechaza tipos de pack --
   * retro-compatible. createPageStore() lo cablea cuando hay packs.
   */
  setCatalog?(catalog: ResolvedCatalog): void;
  listPublicRevisions?(slug: string): Promise<PublicPageRevision[]>;
  listPublicRevisionsByPublicationId?(publicationId: string): Promise<PublicPageRevision[]>;
  importPublicRevisionHistory?(history: unknown): Promise<PageLayout>;
  recordPublicRevisionEvidence?(evidence: PageRevisionEvidence): Promise<void>;
}

export interface PageSaveOptions {
  /** `null` means the caller expects this publication not to exist yet. */
  expectedRevisionId?: string | null;
  actor?: string | null;
}

export interface PageRevisionMetadata {
  publicationId: string;
  revisionId: string;
  revisionNo: number;
  contentHash: string;
  parentRevisionId: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface PageRevisionEvidence {
  evidenceId: string;
  revisionId: string;
  observedAt: string;
  recordedAt: string;
  source: string;
  rulesVersion: string;
  sampleSize: number | null;
  weight: number | null;
  calculation: Record<string, unknown>;
  proof: Record<string, unknown> | null;
}

export interface PublicPageRevision extends Omit<PageRevisionMetadata, "approvedBy"> {
  slug: string;
  title: string;
  layout: PageLayout;
  evidence: PageRevisionEvidence[];
}

const STORAGE_PREFIX = "portaless.atomic-elements.page.";

export class LocalStoragePageStore implements PageStore {
  private catalog?: ResolvedCatalog;

  setCatalog(catalog: ResolvedCatalog): void {
    this.catalog = catalog;
  }

  async load(slug: string): Promise<PageLayout | null> {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    return raw ? (JSON.parse(raw) as PageLayout) : null;
  }

  async save(layout: PageLayout, options: PageSaveOptions = {}): Promise<PageRevisionMetadata> {
    const result = validatePageLayout(layout, this.catalog);
    if (!result.valid) {
      throw new Error("Layout inválido: " + result.errors.join("; "));
    }
    const current = await this.load(layout.slug);
    const expected = Object.hasOwn(options, "expectedRevisionId") ? options.expectedRevisionId : layout.revisionId;
    if (current && (!expected || expected !== current.revisionId)) throw new Error("revision_conflict");
    if (!current && expected != null) throw new Error("revision_conflict");
    const { buildPageRevision } = await import("./revision-history");
    const revision = await buildPageRevision(layout, current, options.actor ?? null);
    localStorage.setItem(STORAGE_PREFIX + layout.slug, JSON.stringify(revision.layout, null, 2));
    return revision.metadata;
  }

  async list(): Promise<string[]> {
    const slugs: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) slugs.push(key.slice(STORAGE_PREFIX.length));
    }
    return slugs;
  }

  async remove(slug: string): Promise<boolean> {
    const key = STORAGE_PREFIX + slug;
    const existed = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    return existed;
  }
}
