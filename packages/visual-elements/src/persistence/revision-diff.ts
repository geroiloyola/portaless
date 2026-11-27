import type { PageLayout } from "../types";

export interface PageDiffEntry { path: string; before: unknown; after: unknown }
export interface PageDiff { changes: PageDiffEntry[]; truncated: boolean }

function comparableLayout(layout: PageLayout): Record<string, unknown> {
  const value = { ...layout } as Record<string, unknown>;
  for (const field of ["status", "revisionId", "revisionNo", "contentHash", "publicationId"]) delete value[field];
  return value;
}

function safeDiffValue(value: unknown): unknown {
  const maxChars = 1024;
  if (typeof value === "string") return value.length > maxChars ? { preview: value.slice(0, maxChars), truncated: true } : value;
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > maxChars
    ? { preview: serialized.slice(0, maxChars), truncated: true }
    : value;
}

function visit(before: unknown, after: unknown, path: string, output: PageDiffEntry[], limit: number): void {
  if (output.length >= limit || JSON.stringify(before) === JSON.stringify(after)) return;
  const beforeObject = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : null;
  const afterObject = after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : null;
  if (beforeObject && afterObject) {
    for (const key of [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort()) {
      if (output.length >= limit) return;
      visit(beforeObject[key], afterObject[key], path ? `${path}.${key}` : key, output, limit);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length) && output.length < limit; index++) {
      visit(before[index], after[index], `${path}[${index}]`, output, limit);
    }
    return;
  }
  output.push({ path: path || "$", before: safeDiffValue(before), after: safeDiffValue(after) });
}

/** Compact content diff for admin review. Metadata/status fields are omitted. */
export function diffPageLayouts(before: PageLayout, after: PageLayout, limit = 100): PageDiff {
  const changes: PageDiffEntry[] = [];
  visit(comparableLayout(before), comparableLayout(after), "", changes, limit);
  return { changes, truncated: changes.length >= limit };
}
