import { afterEach, describe, expect, it, vi } from "vitest";
import { ResolutionBudget, RESOLUTION_STAGES, resolutionClientBucket, resolutionClientBuckets, __resetResolutionHmacDayForTests, type ResolutionContext } from "../../packages/trust-layer/src/net/resolution-budget";

const base: ResolutionContext = { clientBucket: "a".repeat(64), directoryOrigin: "https://reader.example", stage: "directory" };
const small = { windowMs: 60_000, client: { attempts: 3, bytes: 100 }, origin: { attempts: 2, bytes: 100 }, maxBuckets: 12,
  maxConcurrentTotal: 8, maxConcurrentPerClient: 4, maxConcurrentPerOrigin: 4 };
const good = () => ({ ok: true, text: "ok" });
afterEach(() => vi.restoreAllMocks());

describe("PR2 inactive pre-authentication budget kernel", () => {
  it("retains an exhausted client despite uniformly used filler and continuous eviction", async () => {
    const budget = new ResolutionBudget({ ...small, maxBuckets: 8, client: { attempts: 2, bytes: 1000 }, origin: { attempts: 100, bytes: 10000 } }, () => 0);
    const fetcher = vi.fn(async () => good());
    for (let i = 0; i < 2; i++) await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    // Fillers are uniformly driven to the same limit; tie-breaking used to
    // evict the oldest exhausted client and allow it another fetch.
    for (let i = 0; i < 100; i++) {
      const filler = { ...base, clientBucket: i.toString(16).padStart(64, "0"), directoryOrigin: `https://fill-${i}.example` };
      for (let j = 0; j < 3; j++) await budget.fetch(filler, "https://t.example/", fetcher, { maxBytes: 10 });
    }
    const before = fetcher.mock.calls.length;
    expect(await budget.fetch({ ...base, directoryOrigin: "https://fresh.example" }, "https://t.example/", fetcher, { maxBytes: 10 }))
      .toMatchObject({ error: "client_budget_exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(before);
  });
  it("pins byte-denied and exhausted origin quotas until the elapsed window ends", async () => {
    let now = 0;
    const budget = new ResolutionBudget({ ...small, maxBuckets: 4, client: { attempts: 100, bytes: 5 }, origin: { attempts: 1, bytes: 100 } }, () => now);
    await budget.fetch(base, "https://t.example/", async () => good(), { maxBytes: 5 });
    expect(await budget.fetch({ ...base, directoryOrigin: "https://new.example" }, "https://t.example/", async () => good(), { maxBytes: 5 })).toMatchObject({ status: 429 });
    for (let i = 0; i < 10; i++) await budget.fetch({ ...base, clientBucket: i.toString(16).padStart(64, "0"), directoryOrigin: `https://o-${i}.example` }, "https://t.example/", async () => good(), { maxBytes: 5 });
    expect(await budget.fetch({ ...base, clientBucket: "f".repeat(64) }, "https://t.example/", async () => good(), { maxBytes: 5 })).toMatchObject({ error: "origin_budget_exhausted" });
    now = 60_000;
    expect((await budget.fetch(base, "https://t.example/", async () => good(), { maxBytes: 5 })).ok).toBe(true);
  });
  it("admits a legitimate client after 10,000 completed one-use clients fill the quota table", async () => {
    const budget = new ResolutionBudget(undefined, () => 0);
    let started = 0;
    const fetcher = async () => { started++; return good(); };
    for (let i = 0; i < 10_000; i++) {
      await budget.fetch({ ...base, clientBucket: i.toString(16).padStart(64, "0"), directoryOrigin: `https://churn-${i}.example` },
        "https://target.example/", fetcher, { maxBytes: 10 });
    }
    expect((await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
    expect(started).toBe(10_001);
    expect(budget.stateForTests().buckets.length).toBeLessThanOrEqual(4096);
    expect(budget.stateForTests().activeTotal).toBe(0);
    expect(budget.stateForTests().idleEntries).toBeLessThanOrEqual(4096);
  }, 20_000);
  it("uses elapsed monotonic time despite forward and backwards wall-clock jumps", async () => {
    let wall = 0;
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 } });
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 });
    wall = 12 * 60 * 60 * 1000;
    expect(await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 })).toMatchObject({ status: 429 });
    wall = -12 * 60 * 60 * 1000;
    expect(await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 })).toMatchObject({ status: 429 });
    elapsed = 60_000;
    expect((await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("limits an unauthenticated client across rotated origins before egress", async () => {
    const budget = new ResolutionBudget(small);
    const fetcher = vi.fn(async () => good());
    for (let i = 0; i < 3; i++) expect((await budget.fetch({ ...base, directoryOrigin: `https://o-${i}.example` }, "https://target.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
    expect(await budget.fetch({ ...base, directoryOrigin: "https://rotated.example" }, "https://target.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "client_budget_exhausted", status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("limits a directory origin across different clients and stage/URL changes", async () => {
    const budget = new ResolutionBudget(small);
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://operator.example/keys", fetcher, { maxBytes: 10 });
    await budget.fetch({ ...base, clientBucket: "b".repeat(64), stage: "txt_doh" }, "https://doh.example/query", fetcher, { maxBytes: 10 });
    expect(await budget.fetch({ ...base, clientBucket: "c".repeat(64), stage: "history" }, "https://history.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "origin_budget_exhausted", status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("atomically reserves bytes before concurrent fetches; a failed attempt is charged", async () => {
    const budget = new ResolutionBudget({ ...small, client: { attempts: 50, bytes: 100 }, origin: { attempts: 50, bytes: 100 } });
    let release!: (value: any) => void;
    const fetcher = vi.fn(() => new Promise<any>((done) => { release = done; }));
    const first = budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 80 });
    expect(await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 80 })).toMatchObject({ error: "client_budget_exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    release({ ok: false, error: "timeout" });
    await first;
    expect(budget.stateForTests().buckets.every((row) => row.bytes === 80 && row.attempts === 1)).toBe(true);
    expect(budget.stateForTests().activeTotal).toBe(0);
  });
  it("releases active concurrency on success and retains only consumed bytes", async () => {
    const budget = new ResolutionBudget({ ...small, maxConcurrentTotal: 1 });
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 });
    expect(budget.stateForTests().activeTotal).toBe(0);
    expect(budget.stateForTests().activeClients).toHaveLength(0);
    expect(budget.stateForTests().buckets.every((row) => row.bytes === 2 && row.attempts === 1)).toBe(true);
    expect((await budget.fetch(base, "https://target.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("rejects a concurrent hop at the active limit and admits again after the permit releases", async () => {
    const budget = new ResolutionBudget({ ...small, client: { attempts: 10, bytes: 1000 }, origin: { attempts: 10, bytes: 1000 }, maxConcurrentTotal: 1 });
    let release!: (value: any) => void;
    const slow = vi.fn(() => new Promise<any>((done) => { release = done; }));
    const first = budget.fetch(base, "https://target.example/", slow, { maxBytes: 10 });
    await Promise.resolve();
    expect(await budget.fetch({ ...base, clientBucket: "b".repeat(64) }, "https://target.example/", slow, { maxBytes: 10 }))
      .toMatchObject({ error: "client_budget_exhausted", status: 429 });
    expect(slow).toHaveBeenCalledTimes(1);
    release(good());
    await first;
    expect(budget.stateForTests().activeTotal).toBe(0);
    const next = budget.fetch({ ...base, clientBucket: "b".repeat(64) }, "https://target.example/", async () => good(), { maxBytes: 10 });
    expect((await next).ok).toBe(true);
  });
  it("releases active concurrency on timeout while retaining its attempt charge", async () => {
    const budget = new ResolutionBudget({ ...small, maxConcurrentTotal: 1 });
    await budget.fetch(base, "https://target.example/", async () => ({ ok: false, error: "timeout" }), { maxBytes: 10 });
    expect(budget.stateForTests().activeTotal).toBe(0);
    expect(budget.stateForTests().buckets.every((row) => row.attempts === 1 && row.bytes === 10)).toBe(true);
  });
  it("releases active concurrency after abort rejection", async () => {
    const budget = new ResolutionBudget({ ...small, maxConcurrentTotal: 1 });
    await budget.fetch(base, "https://target.example/", async () => { throw new DOMException("aborted", "AbortError"); }, { maxBytes: 10 });
    expect(budget.stateForTests().activeTotal).toBe(0);
    expect(budget.stateForTests().buckets.every((row) => row.attempts === 1)).toBe(true);
  });
  it("releases active concurrency after an exception", async () => {
    const budget = new ResolutionBudget({ ...small, maxConcurrentTotal: 1 });
    await expect(budget.fetch(base, "https://target.example/", async () => { throw new Error("synthetic failure"); }, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, error: "network_error" });
    expect(budget.stateForTests().activeTotal).toBe(0);
    expect(budget.stateForTests().activeOrigins).toHaveLength(0);
  });
  it.each(RESOLUTION_STAGES)("accounts %s and forbids hidden uncharged redirects", async (stage) => {
    const budget = new ResolutionBudget(small);
    const fetcher = vi.fn(async () => good());
    await budget.fetch({ ...base, stage }, "https://target.example/", fetcher, { maxBytes: 10, maxRedirects: 3 });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ maxBytes: 10, maxRedirects: 0 });
    expect(budget.stateForTests().buckets.every((row) => row.attempts === 1 && row.bytes === 2)).toBe(true);
  });
  it("resets only at the elapsed-time window, with positive Retry-After", async () => {
    let now = 59_000;
    const budget = new ResolutionBudget(small, () => now);
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ retryAfterSeconds: 1 });
    now = 60_000;
    expect((await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("rejects saturation without evicting buckets with active leases, then admits after release", async () => {
    let now = 0;
    const budget = new ResolutionBudget({ ...small, maxBuckets: 2 }, () => now);
    const fetcher = vi.fn(async () => good());
    let release!: (value: any) => void;
    const first = budget.fetch(base, "https://t.example/", () => new Promise<any>((done) => { release = done; }), { maxBytes: 10 });
    expect(await budget.fetch({ ...base, clientBucket: "b".repeat(64), directoryOrigin: "https://new.example" }, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "budget_state_full", status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
    release(good());
    await first;
    expect((await budget.fetch({ ...base, clientBucket: "b".repeat(64), directoryOrigin: "https://new.example" }, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("evicts idle low-use buckets first and retains higher-use and current-request quota", async () => {
    const budget = new ResolutionBudget({ ...small, maxBuckets: 4, client: { attempts: 10, bytes: 100 }, origin: { attempts: 10, bytes: 100 } }, () => 0);
    await budget.fetch(base, "https://t.example/", async () => good(), { maxBytes: 10 });
    await budget.fetch(base, "https://t.example/", async () => good(), { maxBytes: 10 });
    await budget.fetch({ ...base, clientBucket: "b".repeat(64), directoryOrigin: "https://low-use.example" }, "https://t.example/", async () => good(), { maxBytes: 10 });
    await budget.fetch({ ...base, clientBucket: "c".repeat(64), directoryOrigin: "https://new.example" }, "https://t.example/", async () => good(), { maxBytes: 10 });
    const keys = budget.stateForTests().buckets.map((row) => row.key);
    expect(keys).toContain(`client:${base.clientBucket}`);
    expect(keys).toContain(`origin:${base.directoryOrigin}`);
    expect(keys).not.toContain(`client:${"b".repeat(64)}`);
    expect(keys).not.toContain("origin:https://low-use.example");
  });
  it("releases same-origin permits correctly when concurrent fetches finish out of order", async () => {
    const budget = new ResolutionBudget(small, () => 0);
    const releases: Array<(value: any) => void> = [];
    const fetcher = () => new Promise<any>((done) => releases.push(done));
    const a = budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    const b = budget.fetch({ ...base, clientBucket: "b".repeat(64) }, "https://t.example/", fetcher, { maxBytes: 10 });
    releases[0](good());
    await a;
    expect(budget.stateForTests().activeOrigins).toEqual([[`origin:${base.directoryOrigin}`, 1]]);
    releases[1](good());
    await b;
    expect(budget.stateForTests().activeOrigins).toEqual([]);
  });
  it("keeps quota state bounded under many client/origin buckets and sweeps expired windows", async () => {
    let now = 0;
    const budget = new ResolutionBudget({ ...small, maxBuckets: 10 }, () => now);
    const fetcher = vi.fn(async () => good());
    for (let i = 0; i < 50; i++) {
      await budget.fetch({ ...base, clientBucket: i.toString(16).padStart(64, "0"), directoryOrigin: `https://o-${i}.example` }, "https://t.example/", fetcher, { maxBytes: 1 });
      expect(budget.stateForTests().buckets.length).toBeLessThanOrEqual(10);
    }
    now = 60_000;
    await budget.fetch({ ...base, clientBucket: "f".repeat(64), directoryOrigin: "https://new-window.example" }, "https://t.example/", fetcher, { maxBytes: 1 });
    expect(budget.stateForTests().buckets).toHaveLength(2);
  });
  it("does not reopen a quota while the injected elapsed clock has not reached expiry", async () => {
    let now = 60_000;
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 } }, () => now);
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    now = 60_001;
    expect(await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "client_budget_exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("contains unknown-client exhaustion to the shared unknown bucket", async () => {
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 } });
    const fetcher = vi.fn(async () => good());
    const unknown = { ...base, clientBucket: "unknown" };
    await budget.fetch(unknown, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch(unknown, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "client_budget_exhausted" });
    expect((await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("returns only public retry duration and stable rejection fields", async () => {
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 } });
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 1 });
    const rejection = await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 1 });
    expect(rejection).toEqual({ ok: false, error: "client_budget_exhausted", status: 429, retryAfterSeconds: expect.any(Number) });
  });
  it("rejects impossible byte results and configuration, keeping its reservation", async () => {
    expect(() => new ResolutionBudget({ ...small, windowMs: 0 })).toThrow("invalid_resolution_budget");
    const budget = new ResolutionBudget(small);
    expect(await budget.fetch(base, "https://t.example/", async () => ({ ok: true, text: "too long" }), { maxBytes: 2 })).toMatchObject({ error: "too_large" });
    expect(budget.stateForTests().buckets[0].bytes).toBe(2);
  });
});

describe("trusted-ingress client bucket", () => {
  const secret = "synthetic-test-only-secret-for-hmac";
  it("a forward wall-clock day jump resets HMAC client allowance but not the origin quota", async () => {
    __resetResolutionHmacDayForTests();
    const request = new Request("https://site.example/", { headers: { "x-portaless-client-ip": "192.0.2.10" } });
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 }, origin: { attempts: 2, bytes: 100 } }, () => 0);
    const bucket = (now: number) => resolutionClientBuckets(request, { runtime: "node", secret, now });
    const fetcher = async () => good();
    const first = await bucket(0);
    await budget.fetch({ ...base, clientBucket: first }, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch({ ...base, clientBucket: first }, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ status: 429 });
    const jumped = await bucket(2 * 86_400_000);
    expect(jumped).not.toEqual(first);
    expect((await budget.fetch({ ...base, clientBucket: jumped }, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
    expect(await bucket(0)).toEqual(jumped); // high-water day does not roll back
    const later = await bucket(3 * 86_400_000);
    expect(await budget.fetch({ ...base, clientBucket: later }, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "origin_budget_exhausted" });
    __resetResolutionHmacDayForTests();
  });
  it("uses only the Node-injected client IP and stores no raw IP", async () => {
    __resetResolutionHmacDayForTests();
    const request = new Request("https://site.example/", { headers: { "x-portaless-client-ip": "127.0.0.1", "CF-Connecting-IP": "1.2.3.4" } });
    const key = await resolutionClientBucket(request, { runtime: "node", secret, now: 0 });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("127.0.0.1");
    const next = await resolutionClientBucket(request, { runtime: "node", secret, now: 86_400_000 });
    expect(next).not.toBe(key);
  });
  it("preserves quota identity across an overlapping two-secret HMAC rotation", async () => {
    __resetResolutionHmacDayForTests();
    const request = new Request("https://site.example/", { headers: { "x-portaless-client-ip": "192.0.2.44" } });
    const oldOnly = await resolutionClientBuckets(request, { runtime: "node", secret: "o".repeat(32), now: 0 });
    const duringRotation = await resolutionClientBuckets(request, { runtime: "node", secret: "n".repeat(32), previousSecret: "o".repeat(32), now: 0 });
    expect(duringRotation).toHaveLength(2);
    expect(duringRotation).toContain(oldOnly[0]);
    const budget = new ResolutionBudget({ ...small, client: { attempts: 1, bytes: 100 } });
    const fetcher = vi.fn(async () => good());
    await budget.fetch({ ...base, clientBucket: oldOnly }, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch({ ...base, clientBucket: duringRotation }, "https://other.example/", fetcher, { maxBytes: 10 }))
      .toMatchObject({ error: "client_budget_exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires trusted Cloudflare ingress and ignores the client-supplied Node header there", async () => {
    const request = new Request("https://site.example/", { headers: { "CF-Connecting-IP": "1.2.3.4", "x-portaless-client-ip": "5.6.7.8" } });
    expect(await resolutionClientBucket(request, { runtime: "cloudflare", secret })).toBe("unknown");
    expect(await resolutionClientBucket(request, { runtime: "cloudflare", trustedCloudflareIngress: true, secret })).toMatch(/^[a-f0-9]{64}$/);
  });
  it("uses a shared unknown bucket for missing trusted IP or secret, never an unlimited exemption", async () => {
    expect(await resolutionClientBucket(new Request("https://site.example/"), { runtime: "node", secret })).toBe("unknown");
    expect(await resolutionClientBucket(new Request("https://site.example/", { headers: { "x-portaless-client-ip": "1.2.3.4" } }), { runtime: "node" })).toBe("unknown");
  });
  it("does not reinterpret malformed IP headers as URL authority/path syntax", async () => {
    for (const ip of ["user@1.2.3.4", "1.2.3.4/path", "1.2.3.4?query", "not-an-ip", "[::1]"]) {
      expect(await resolutionClientBucket(new Request("https://site.example/", { headers: { "x-portaless-client-ip": ip } }), { runtime: "node", secret })).toBe("unknown");
    }
  });
  it("does not roll the HMAC day backwards with a simulated wall clock", async () => {
    __resetResolutionHmacDayForTests();
    const request = new Request("https://site.example/", { headers: { "x-portaless-client-ip": "192.0.2.10" } });
    const later = await resolutionClientBucket(request, { runtime: "node", secret, now: 86_400_000 });
    const backwards = await resolutionClientBucket(request, { runtime: "node", secret, now: 0 });
    expect(backwards).toBe(later);
    __resetResolutionHmacDayForTests();
  });
});
