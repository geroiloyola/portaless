import { describe, expect, it, vi } from "vitest";
import { ResolutionBudget, RESOLUTION_STAGES, resolutionClientBucket, type ResolutionContext } from "../../packages/trust-layer/src/net/resolution-budget";

const base: ResolutionContext = { clientBucket: "a".repeat(64), directoryOrigin: "https://reader.example", stage: "directory" };
const small = { windowMs: 60_000, client: { attempts: 3, bytes: 100 }, origin: { attempts: 2, bytes: 100 }, maxBuckets: 12 };
const good = () => ({ ok: true, text: "ok" });

describe("PR2 inactive pre-authentication budget kernel", () => {
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
    expect(budget.stateForTests().every((row) => row.bytes === 80 && row.attempts === 1)).toBe(true);
  });
  it.each(RESOLUTION_STAGES)("accounts %s and forbids hidden uncharged redirects", async (stage) => {
    const budget = new ResolutionBudget(small);
    const fetcher = vi.fn(async () => good());
    await budget.fetch({ ...base, stage }, "https://target.example/", fetcher, { maxBytes: 10, maxRedirects: 3 });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ maxBytes: 10, maxRedirects: 0 });
    expect(budget.stateForTests().every((row) => row.attempts === 1 && row.bytes === 2)).toBe(true);
  });
  it("resets only at the bounded UTC window, with positive Retry-After", async () => {
    let now = 59_000;
    const budget = new ResolutionBudget(small, () => now);
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ retryAfterSeconds: 1 });
    now = 60_000;
    expect((await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("never evicts active quota state to admit more origins", async () => {
    let now = 0;
    const budget = new ResolutionBudget({ ...small, maxBuckets: 2 }, () => now);
    const fetcher = vi.fn(async () => good());
    await budget.fetch(base, "https://t.example/", fetcher, { maxBytes: 10 });
    expect(await budget.fetch({ ...base, clientBucket: "b".repeat(64), directoryOrigin: "https://new.example" }, "https://t.example/", fetcher, { maxBytes: 10 })).toMatchObject({ error: "budget_state_full", status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 60_000;
    expect((await budget.fetch({ ...base, clientBucket: "b".repeat(64), directoryOrigin: "https://new.example" }, "https://t.example/", fetcher, { maxBytes: 10 })).ok).toBe(true);
  });
  it("rejects impossible byte results and configuration, keeping its reservation", async () => {
    expect(() => new ResolutionBudget({ ...small, windowMs: 0 })).toThrow("invalid_resolution_budget");
    const budget = new ResolutionBudget(small);
    expect(await budget.fetch(base, "https://t.example/", async () => ({ ok: true, text: "too long" }), { maxBytes: 2 })).toMatchObject({ error: "too_large" });
    expect(budget.stateForTests()[0].bytes).toBe(2);
  });
});

describe("trusted-ingress client bucket", () => {
  const secret = "synthetic-test-only-secret-for-hmac";
  it("uses only the Node-injected client IP and stores no raw IP", async () => {
    const request = new Request("https://site.example/", { headers: { "x-portaless-client-ip": "127.0.0.1", "CF-Connecting-IP": "1.2.3.4" } });
    const key = await resolutionClientBucket(request, { runtime: "node", secret, now: 0 });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("127.0.0.1");
    const next = await resolutionClientBucket(request, { runtime: "node", secret, now: 86_400_000 });
    expect(next).not.toBe(key);
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
});
