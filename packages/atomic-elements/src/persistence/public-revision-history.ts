import type { PageLayout } from "../types";
import type { PageRevisionEvidence, PublicPageRevision } from "./page-store";
import { pageContentHash, validateRevisionEvidence } from "./revision-history";

export const PUBLIC_REVISION_HISTORY_FORMAT = "portaless-public-revision-history/v1" as const;

export interface PublicRevisionHistoryRecord {
  revisionId: string;
  revisionNo: number;
  contentHash: string;
  parentRevisionId: string | null;
  createdAt: string;
  publishedAt: string;
  title: string;
  layout: PageLayout;
  changedPaths: string[];
  reputation:
    | { status: "no_data"; observations: [] }
    | { status: "observed"; observations: PageRevisionEvidence[] };
}

export interface PublicRevisionHistory {
  format: typeof PUBLIC_REVISION_HISTORY_FORMAT;
  publicationId: string;
  slug: string;
  revisions: PublicRevisionHistoryRecord[];
}

export async function validatePortablePublicRevisionHistory(input: unknown): Promise<PublicRevisionHistory> {
  if (!input || typeof input !== "object") throw new Error("invalid_revision_history");
  const history = input as PublicRevisionHistory;
  if (history.format !== PUBLIC_REVISION_HISTORY_FORMAT || typeof history.publicationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(history.publicationId) ||
      typeof history.slug !== "string" || !history.slug || !Array.isArray(history.revisions) ||
      history.revisions.length < 1 || history.revisions.length > 100) throw new Error("invalid_revision_history");

  const seen = new Set<string>();
  for (let index = 0; index < history.revisions.length; index++) {
    const revision = history.revisions[index];
    if (!revision || typeof revision !== "object" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revision.revisionId) ||
        seen.has(revision.revisionId) || !Number.isInteger(revision.revisionNo) || revision.revisionNo < 1 ||
        (index > 0 && history.revisions[index - 1].revisionNo <= revision.revisionNo) ||
        revision.parentRevisionId !== (history.revisions[index + 1]?.revisionId ?? null) ||
        revision.layout?.slug !== history.slug || revision.layout?.publicationId !== history.publicationId ||
        revision.layout?.revisionId !== revision.revisionId || revision.layout?.revisionNo !== revision.revisionNo ||
        revision.layout?.contentHash !== revision.contentHash ||
        (revision.layout?.status !== undefined && revision.layout.status !== "published") ||
        !Number.isFinite(Date.parse(revision.createdAt)) || !Number.isFinite(Date.parse(revision.publishedAt))) {
      throw new Error("invalid_revision_history");
    }
    const observations = revision.reputation?.observations;
    if (!Array.isArray(observations) ||
        (revision.reputation.status === "no_data" && observations.length !== 0) ||
        (revision.reputation.status === "observed" && observations.length === 0) ||
        (revision.reputation.status !== "no_data" && revision.reputation.status !== "observed") ||
        observations.some((observation) => {
          try {
            validateRevisionEvidence(observation);
            return observation.revisionId !== revision.revisionId;
          } catch {
            return true;
          }
        })) {
      throw new Error("invalid_revision_history");
    }
    if (await pageContentHash(revision.layout) !== revision.contentHash) throw new Error("revision_content_hash_mismatch");
    seen.add(revision.revisionId);
  }
  return history;
}

function contentOnly(layout: PageLayout): Record<string, unknown> {
  const { publicationId: _publicationId, revisionId: _revisionId, revisionNo: _revisionNo, contentHash: _contentHash, status: _status, ...content } = layout;
  return content as Record<string, unknown>;
}

function changedPaths(previous: PageLayout | null, current: PageLayout): string[] {
  if (!previous) return [];
  const changes: string[] = [];
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index++) visit(left[index], right[index], `${path}[${index}]`);
      return;
    }
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) visit((left as any)[key], (right as any)[key], path ? `${path}.${key}` : key);
      return;
    }
    changes.push(path || "content");
  };
  visit(contentOnly(previous), contentOnly(current), "");
  return changes.slice(0, 200);
}

/** Creates a public-only projection. Private actor identifiers and private parent pointers are omitted. */
export function projectPublicRevisionHistory(revisions: PublicPageRevision[]): PublicRevisionHistory | null {
  if (revisions.length === 0) return null;
  const chronological = [...revisions].sort((left, right) => left.revisionNo - right.revisionNo);
  const records = chronological.map((revision, index) => ({
    revisionId: revision.revisionId,
    revisionNo: revision.revisionNo,
    contentHash: revision.contentHash,
    parentRevisionId: chronological[index - 1]?.revisionId ?? null,
    createdAt: revision.createdAt,
    publishedAt: revision.approvedAt!,
    title: revision.title,
    layout: revision.layout,
    changedPaths: changedPaths(chronological[index - 1]?.layout ?? null, revision.layout),
    // Site-level APW observations have no content revision subject; do not
    // attribute them to a page. A real empty set remains `no_data`.
    reputation: revision.evidence.length > 0
      ? { status: "observed" as const, observations: revision.evidence }
      : { status: "no_data" as const, observations: [] as [] },
  }));
  return {
    format: PUBLIC_REVISION_HISTORY_FORMAT,
    publicationId: chronological[0].publicationId,
    slug: chronological[0].slug,
    revisions: records.reverse(),
  };
}
