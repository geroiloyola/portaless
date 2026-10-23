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

it("preserves heap order and the exact position bijection after every seeded random operation (#102)", () => {
  type Entry = { key: string; attempts: number; bytes: number; order: number };
  const heap = new IdleBucketIndex();
  // Inspect representation only in this regression; no production debug API.
  const internals = heap as unknown as { entries: Entry[]; positions: Map<string, number> };
  const model = new Map<string, Entry>();
  let seed = 0x1025a3;
  const random = (n: number) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const compare = (a: Entry, b: Entry) => a.attempts - b.attempts || a.bytes - b.bytes || a.order - b.order;
  const operations = new Set<string>();
  for (let step = 0; step < 5000; step++) {
    const key = `bucket-${random(97)}`;
    const op = random(4);
    if (op < 2) {
      const target = op === 1 && model.size ? [...model.keys()][random(model.size)] : key;
      operations.add(model.has(target) ? "update" : "set");
      const entry = { key: target, attempts: random(8), bytes: random(8), order: step };
      heap.set(entry); model.set(target, entry);
    } else if (op === 2) {
      operations.add("remove"); heap.remove(key); model.delete(key);
    } else {
      operations.add("pop");
      const first = [...model.values()].sort(compare)[0]?.key;
      expect(heap.pop(), `pop at step ${step}`).toBe(first);
      if (first !== undefined) model.delete(first);
    }
    expect(heap.size).toBe(model.size);
    expect(internals.positions.size).toBe(model.size);
    expect(new Set(internals.entries.map(e => e.key)).size).toBe(model.size);
    for (const [i, entry] of internals.entries.entries()) {
      expect(internals.positions.get(entry.key), `position at step ${step}`).toBe(i);
      expect(entry).toEqual(model.get(entry.key));
      if (i) expect(compare(internals.entries[(i - 1) >> 1], entry), `order at step ${step}`).toBeLessThanOrEqual(0);
    }
    for (const [key, position] of internals.positions) expect(internals.entries[position]?.key).toBe(key);
  }
  expect([...operations].sort()).toEqual(["pop", "remove", "set", "update"]);
});
