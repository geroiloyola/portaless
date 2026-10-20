import type { PageLayout } from "../types";
import type { PageRevisionEvidence, PageRevisionMetadata } from "./page-store";

export interface BuiltPageRevision {
  layout: PageLayout;
  metadata: PageRevisionMetadata;
}

function stableValue(value: unknown, root = false): unknown {
  if (Array.isArray(value)) return value.map((child) => stableValue(child));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !root || !["publicationId", "revisionId", "revisionNo", "contentHash"].includes(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export async function pageContentHash(layout: PageLayout): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(layout, true)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function validateRevisionEvidence(evidence: PageRevisionEvidence): void {
  if (!evidence || typeof evidence !== "object" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.evidenceId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.revisionId) ||
      !Number.isFinite(Date.parse(evidence.observedAt)) || !Number.isFinite(Date.parse(evidence.recordedAt)) ||
      typeof evidence.source !== "string" || !evidence.source.trim() || evidence.source.length > 512 ||
      typeof evidence.rulesVersion !== "string" || !evidence.rulesVersion.trim() || evidence.rulesVersion.length > 128 ||
      (evidence.sampleSize !== null && (!Number.isInteger(evidence.sampleSize) || evidence.sampleSize < 1)) ||
      (evidence.weight !== null && (!Number.isFinite(evidence.weight) || evidence.weight <= 0)) ||
      !evidence.calculation || typeof evidence.calculation !== "object" || Array.isArray(evidence.calculation) ||
      (evidence.proof !== null && (!evidence.proof || typeof evidence.proof !== "object" || Array.isArray(evidence.proof)))) {
    throw new Error("invalid_revision_evidence");
  }
  if (JSON.stringify(evidence.calculation).length > 64 * 1024 || JSON.stringify(evidence.proof).length > 64 * 1024) {
    throw new Error("revision_evidence_too_large");
  }
}

export function newRevisionIdentity(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function buildPageRevision(
  layout: PageLayout,
  current: PageLayout | null,
  actor: string | null = null,
  now = new Date().toISOString(),
): Promise<BuiltPageRevision> {
  const publicationId = current?.publicationId ?? layout.publicationId ?? newRevisionIdentity();
  const revisionId = newRevisionIdentity();
  const revisionNo = (current?.revisionNo ?? 0) + 1;
  const contentHash = await pageContentHash(layout);
  const publiclyApproved = !layout.slug.endsWith("-draft") && (layout.status === undefined || layout.status === "published");
  const approvedAt = publiclyApproved ? now : null;
  const metadata: PageRevisionMetadata = {
    publicationId,
    revisionId,
    revisionNo,
    contentHash,
    parentRevisionId: current?.revisionId ?? null,
    createdAt: now,
    approvedAt,
    approvedBy: publiclyApproved ? actor : null,
  };
  const revisedLayout: PageLayout = { ...layout, publicationId, revisionId, revisionNo, contentHash };
  return { layout: revisedLayout, metadata };
}
