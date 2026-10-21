// Site-level publication snapshot: the exact set of approved public page
// revisions a publish run is allowed to export. It is the idempotency key and
// the retry guard: a run can only publish/retry the snapshot it started with.

import { isPubliclyPublishable, type PublicationCandidate } from "./draft-filter";

export interface PublicationLayoutLike extends PublicationCandidate {
  slug: string;
  revisionId?: string;
}

export interface PublicationSnapshot {
  siteId: string;
  revisionIds: Record<string, string>;
  hash: string;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function snapshotFromLayouts(
  siteId: string,
  layouts: ReadonlyArray<PublicationLayoutLike>,
): Promise<PublicationSnapshot> {
  const entries: Array<[string, string]> = [];
  for (const layout of layouts) {
    if (!isPubliclyPublishable(layout)) continue;
    if (typeof layout.revisionId !== "string" || !layout.revisionId) continue;
    entries.push([layout.slug, layout.revisionId]);
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const revisionIds = Object.fromEntries(entries);
  const hash = `sha256:${await sha256Hex(JSON.stringify({ siteId, revisionIds }))}`;
  return { siteId, revisionIds, hash };
}

export function samePublicationSnapshot(left: PublicationSnapshot, right: PublicationSnapshot): boolean {
  return left.siteId === right.siteId && left.hash === right.hash;
}
