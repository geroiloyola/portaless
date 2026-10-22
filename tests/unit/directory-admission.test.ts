import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryResolver, DIRECTORY_FETCH_COLD_MAX, parseReservedDirectoryOrigins } from "../../packages/trust-layer/src/webbotauth/directory-fetch";
import { ResolutionBudget } from "../../packages/trust-layer/src/net/resolution-budget";

afterEach(() => vi.useRealTimers());

describe("R4 directory admission", () => {
  it("20 slow distinct Signature-Agent origins cannot consume the two locally reserved slots", async () => {
    vi.useFakeTimers();
    const resolver = new DirectoryResolver();
    const fetcher = vi.fn(async () => {
      await new Promise((done) => setTimeout(done, 5000));
      return { ok: true, text: '{"keys":[]}' };
    });
    const flood = Array.from({ length: 20 }, (_, i) => resolver.resolve(`https://slow-${i}.example`, fetcher));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(DIRECTORY_FETCH_COLD_MAX);
    const legitimate = resolver.resolve("https://owner-approved.example", fetcher, ["https://owner-approved.example"]);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(DIRECTORY_FETCH_COLD_MAX + 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await legitimate).ok).toBe(true);
    const outcomes = await Promise.all(flood);
    expect(outcomes.filter((result) => !result.ok)).toHaveLength(20 - DIRECTORY_FETCH_COLD_MAX);
    expect(resolver.state().inFlight).toBe(0);
  });

  it("single-flight shares 20 same-origin requests and preserves capacity for a different cold directory", async () => {
    const resolver = new DirectoryResolver();
    let release!: (value: any) => void;
    const slow = vi.fn(() => new Promise<any>((done) => { release = done; }));
    const requests = Array.from({ length: 20 }, () => resolver.resolve("https://slow.example", slow));
    await Promise.resolve();
    expect(slow).toHaveBeenCalledTimes(1);
    const good = await resolver.resolve("https://legitimate.example", async () => ({ ok: true, text: '{"keys":[]}' }));
    expect(good.ok).toBe(true);
    release({ ok: false, error: "timeout" });
    expect((await Promise.all(requests)).every((r) => !r.ok)).toBe(true);
    expect(resolver.state().inFlight).toBe(0);
  });

  it("post97: directory_busy is never negative-cached; a cold legitimate origin retries when a slot frees", async () => {
    const resolver = new DirectoryResolver();
    const releases: Array<(value: any) => void> = [];
    const slow = () => new Promise<any>((done) => releases.push(done));
    const pending = Array.from({ length: DIRECTORY_FETCH_COLD_MAX }, (_, i) => resolver.resolve(`https://busy-${i}.example`, slow));
    await Promise.resolve();
    const good = vi.fn(async () => ({ ok: true, text: '{"keys":[]}' }));
    expect(await resolver.resolve("https://legitimate.example", good)).toMatchObject({ reason: "directory_busy" });
    expect(good).not.toHaveBeenCalled();
    expect(resolver.state().negative).toBe(0);
    releases[0]({ ok: true, text: '{"keys":[]}' });
    await pending[0];
    expect((await resolver.resolve("https://legitimate.example", good)).ok).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    for (const done of releases.slice(1)) done({ ok: true, text: '{"keys":[]}' });
    await Promise.all(pending);
  });

  it("cached failures have a decreasing Retry-After, true LRU, and retry after 60 seconds", async () => {
    let now = 0;
    const resolver = new DirectoryResolver(() => now);
    const fail = vi.fn(async () => ({ ok: false, error: "timeout" as const }));
    expect(await resolver.resolve("https://fail.example", fail)).toMatchObject({ ok: false, reason: "directory_unavailable", retryAfterSeconds: 60 });
    now = 5000;
    expect(await resolver.resolve("https://fail.example", fail)).toMatchObject({ reason: "directory_failure_cached", retryAfterSeconds: 55 });
    expect(fail).toHaveBeenCalledTimes(1);
    now = 60_001;
    await resolver.resolve("https://fail.example", fail);
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it("real directory adapter charges pre-auth egress and does not negative-cache budget exhaustion", async () => {
    const resolver = new DirectoryResolver();
    const budget = new ResolutionBudget({ windowMs: 60_000, client: { attempts: 1, bytes: 1024 * 1024 }, origin: { attempts: 10, bytes: 1024 * 1024 },
      maxBuckets: 10, maxConcurrentTotal: 8, maxConcurrentPerClient: 4, maxConcurrentPerOrigin: 4 });
    const fetcher = vi.fn(async () => ({ ok: true, text: '{"keys":[]}' }));
    const context = { budget, clientBucket: "a".repeat(64) };
    expect((await resolver.resolve("https://reader.example", fetcher, [], context)).ok).toBe(true);
    const second = await resolver.resolve("https://other-reader.example", fetcher, [], context);
    expect(second).toMatchObject({ ok: false, reason: "client_budget_exhausted", status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolver.state().negative).toBe(0);
  });

  it("keeps a recently used negative-cache entry and evicts the least recently used origin", async () => {
    const resolver = new DirectoryResolver();
    const fail = vi.fn(async () => ({ ok: false, error: "timeout" as const }));
    for (let i = 0; i < 256; i++) await resolver.resolve(`https://bad-${i}.example`, fail);
    await resolver.resolve("https://bad-0.example", fail);
    await resolver.resolve("https://overflow.example", fail);
    await resolver.resolve("https://bad-0.example", fail);
    expect(fail).toHaveBeenCalledTimes(257);
    await resolver.resolve("https://bad-1.example", fail);
    expect(fail).toHaveBeenCalledTimes(258);
    expect(resolver.state().negative).toBe(256);
  });

  it("only an owner-configured origin retains reserved eligibility with a cold cache", async () => {
    let now = 0;
    const resolver = new DirectoryResolver(() => now);
    const pending: Array<(value: any) => void> = [];
    const slow = () => new Promise<any>((done) => pending.push(done));
    const flood = Array.from({ length: DIRECTORY_FETCH_COLD_MAX }, (_, i) => resolver.resolve(`https://new-${i}.example`, slow));
    const trusted = resolver.resolve("https://verified.example", slow, ["https://verified.example"]);
    await Promise.resolve();
    expect(pending).toHaveLength(DIRECTORY_FETCH_COLD_MAX + 1);
    for (const done of pending) done({ ok: true, text: '{"keys":[]}' });
    await Promise.all([...flood, trusted]);
    now = 600_001;
    expect((await resolver.resolve("https://verified.example", async () => ({ ok: true, text: '{"keys":[]}' }), ["https://verified.example"])).ok).toBe(true);
  });

  it("reserved origins accept only bounded HTTPS origins, normalize/deduplicate, and discard invalid entries", () => {
    expect(parseReservedDirectoryOrigins(" https://EXAMPLE.com.:443, https://example.com, https://BÜCHER.example.,https://xn--bcher-kva.example ").origins)
      .toEqual(["https://example.com", "https://xn--bcher-kva.example"]);
    const invalid = ["http://bad.example", "https://user:password@bad.example", "https://good.example/path", "https://good.example/?key=secret", "https://good.example/#x", "*", "https://*.example", "https://localhost.", "https://127.0.0.1", "https://[::1]", "not-a-url"];
    expect(parseReservedDirectoryOrigins(invalid.join(","))).toEqual({ origins: [], invalidCount: invalid.length });
    expect(parseReservedDirectoryOrigins()).toEqual({ origins: [], invalidCount: 0 });
    const excess = parseReservedDirectoryOrigins(Array.from({ length: 257 }, (_, i) => `https://o-${i}.example`).join(","));
    expect(excess.origins).toHaveLength(256);
    expect(excess.invalidCount).toBe(1);
  });
});
