interface Entry { key: string; attempts: number; bytes: number; order: number }

/** Indexed min-heap: one entry per eligible idle bucket, never lazy tombstones. */
export class IdleBucketIndex {
  private entries: Entry[] = [];
  private positions = new Map<string, number>();
  get size() { return this.entries.length; }
  private less(a: Entry, b: Entry) {
    return a.attempts < b.attempts || (a.attempts === b.attempts
      && (a.bytes < b.bytes || (a.bytes === b.bytes && a.order < b.order)));
  }
  private swap(a: number, b: number) {
    [this.entries[a], this.entries[b]] = [this.entries[b], this.entries[a]];
    this.positions.set(this.entries[a].key, a);
    this.positions.set(this.entries[b].key, b);
  }
  private up(index: number) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(this.entries[index], this.entries[parent])) break;
      this.swap(index, parent); index = parent;
    }
    return index;
  }
  private down(index: number) {
    for (;;) {
      const left = index * 2 + 1, right = left + 1;
      let best = index;
      if (left < this.size && this.less(this.entries[left], this.entries[best])) best = left;
      if (right < this.size && this.less(this.entries[right], this.entries[best])) best = right;
      if (best === index) return;
      this.swap(index, best); index = best;
    }
  }
  remove(key: string) {
    const index = this.positions.get(key);
    if (index === undefined) return;
    this.positions.delete(key);
    const last = this.entries.pop()!;
    if (index === this.size) return;
    this.entries[index] = last;
    this.positions.set(last.key, index);
    this.down(this.up(index));
  }
  set(entry: Entry) {
    this.remove(entry.key);
    this.positions.set(entry.key, this.size);
    this.entries.push(entry);
    this.up(this.size - 1);
  }
  pop(): string | undefined {
    const key = this.entries[0]?.key;
    if (key !== undefined) this.remove(key);
    return key;
  }
}
