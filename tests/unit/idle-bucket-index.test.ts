import { expect, it } from "vitest";
import { IdleBucketIndex } from "../../packages/trust-layer/src/net/idle-bucket-index";

it("keeps least-use order after arbitrary removals and repeated priority updates without growing stale entries", () => {
  const heap = new IdleBucketIndex();
  const expected = new Map<string, { key: string; attempts: number; bytes: number; order: number }>();
  for (let i = 0; i < 1000; i++) {
    const key = `bucket-${i % 73}`;
    const entry = { key, attempts: (i * 17) % 13, bytes: (i * 31) % 11, order: i };
    heap.set(entry); expected.set(key, entry);
    if (i % 3 === 0) { const remove = `bucket-${(i * 7) % 73}`; heap.remove(remove); expected.delete(remove); }
    expect(heap.size).toBe(expected.size);
  }
  const ordered = [...expected.values()].sort((a, b) => a.attempts - b.attempts || a.bytes - b.bytes || a.order - b.order);
  expect(ordered.map(() => heap.pop())).toEqual(ordered.map((entry) => entry.key));
  expect(heap.size).toBe(0);
  expect(heap.pop()).toBeUndefined();
});
