import { describe, expect, test } from "vitest";
import {
  IdleBucketIndex,
  OperationBudget,
  OperationBudgetError,
  PinningError,
  ResolutionBudget,
  __resetResolutionHmacDayForTests,
  assertSafeUrl,
  createSafeFetcher,
  hashClientIpBuckets,
  isBlockedEgressIp,
  isBlockedHostname,
  isBlockedIp,
  isPrivateHost,
  isPrivateIp,
  normalizeClientIp,
  parseTrustedProxies,
  resolveClientIpFromProxyChain,
  resolveForwardedProtocol,
  resolvePinnedAddress,
} from "../src/index";

describe("@portaless/net — SSRF, IP ranges & IPv4-mapped IPv6", () => {
  test("blocks private, loopback, link-local/metadata, CGNAT, documentation and multicast IPv4", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "not-an-ip",
      "",
    ];
    for (const ip of blocked) {
      expect(isBlockedEgressIp(ip), ip).toBe(true);
      expect(isPrivateIp(ip), ip).toBe(true);
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const pub of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) {
      expect(isBlockedEgressIp(pub), pub).toBe(false);
      expect(isBlockedIp(pub), pub).toBe(false);
    }
  });

  test("handles IPv6 special-use and IPv4-mapped IPv6 (dotted & WHATWG hex forms)", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "64:ff9b::1.1.1.1", "ff02::1"]) {
      expect(isBlockedEgressIp(ip), ip).toBe(true);
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedEgressIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);

    // Private IPv4-mapped IPv6 blocked in all modes (dotted and hex)
    for (const mappedPrivate of [
      "::ffff:127.0.0.1",
      "[::ffff:127.0.0.1]",
      "::ffff:169.254.169.254",
      "::ffff:7f00:1",
      "[::ffff:a9fe:a9fe]",
    ]) {
      expect(isBlockedEgressIp(mappedPrivate), mappedPrivate).toBe(true);
      expect(isBlockedIp(mappedPrivate), mappedPrivate).toBe(true);
      expect(isPrivateHost(mappedPrivate), mappedPrivate).toBe(true);
    }

    // Public IPv4-mapped IPv6: blocked by strict egress policy, unwrapped by isBlockedIp/isPrivateHost
    expect(isBlockedEgressIp("::ffff:8.8.8.8")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateHost("[::ffff:8.8.8.8]")).toBe(false);
    expect(isPrivateHost("[::ffff:808:808]")).toBe(false);
  });

  test("blocks reserved hostnames and trailing dots", () => {
    for (const host of ["localhost", "LOCALHOST.", "sub.localhost", "printer.local", "db.internal", "demo.example", "hidden.onion"]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
    expect(isBlockedHostname("portaless.org")).toBe(false);
    expect(isPrivateHost("hooks.example.test")).toBe(false);
    expect(isPrivateHost("svc.internal")).toBe(true);
  });
});

describe("@portaless/net — safeFetch & DNS pinning", () => {
  test("rejects plaintext http, private redirects per hop, too many redirects, and oversized streaming bodies", async () => {
    const calls: string[] = [];
    const safeFetch = createSafeFetcher({
      lookup: async (host) => (host === "public.org" ? ["93.184.216.34"] : ["127.0.0.1"]),
      fetch: async (url) => {
        const s = String(url);
        calls.push(s);
        if (s === "https://public.org/redir-private") {
          return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } });
        }
        if (s === "https://public.org/loop") {
          return new Response(null, { status: 302, headers: { location: "https://public.org/loop" } });
        }
        if (s === "https://public.org/big") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(64));
              controller.enqueue(new Uint8Array(64));
              controller.close();
            },
          });
          return new Response(stream, { status: 200 });
        }
        return new Response('{"ok":true}', { status: 200 });
      },
    });

    await expect(assertSafeUrl(new URL("http://public.org/"))).rejects.toThrow("invalid_url");
    expect((await safeFetch("http://public.org/")).error).toBe("invalid_url");
    expect((await safeFetch("https://public.org/redir-private")).error).toBe("blocked_host");
    expect(calls.some((c) => c.includes("169.254.169.254"))).toBe(false);
    expect((await safeFetch("https://public.org/loop", { maxRedirects: 1 })).error).toBe("too_many_redirects");
    expect((await safeFetch("https://public.org/big", { maxBytes: 100 })).error).toBe("too_large");
    expect((await safeFetch("https://public.org/ok")).ok).toBe(true);
  });

  test("passes resolved IP to fetchPinned and rejects DNS answers containing any private IP", async () => {
    let pinnedIp: string | undefined;
    const safeFetch = createSafeFetcher({
      lookup: async () => ["93.184.216.34"],
      fetchPinned: async (_url, _init, address) => {
        pinnedIp = address;
        return new Response("ok", { status: 200 });
      },
    });
    const res = await safeFetch("https://public.org/data");
    expect(res.ok).toBe(true);
    expect(pinnedIp).toBe("93.184.216.34");

    // Mixed public + private DNS answers must fail closed (anti-DNS-rebinding)
    await expect(
      resolvePinnedAddress("dual.org", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow(PinningError);

    const ok = await resolvePinnedAddress("single.org", async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(ok).toEqual({ address: "93.184.216.34", family: 4 });

    const ac = new AbortController();
    ac.abort();
    await expect(resolvePinnedAddress("single.org", async () => [{ address: "93.184.216.34", family: 4 }], ac.signal))
      .rejects.toMatchObject({ code: "deadline_exceeded" });
  });
});

describe("@portaless/net — egress budgets, concurrency limits & client IP", () => {
  test("OperationBudget reserves before I/O, settles unused bytes, and enforces deadline & signature limits", () => {
    let elapsed = 0;
    const budget = new OperationBudget(
      { httpAttempts: 2, bodyBytes: 100, signatureAttempts: 1, deadlineMs: 500 },
      () => elapsed,
    );
    const h1 = budget.reserveHttp(60, "stage-1");
    expect(budget.bodyBytesUsed).toBe(60);
    h1.settle(20);
    expect(budget.bodyBytesUsed).toBe(20);

    const h2 = budget.reserveHttp(80, "stage-2");
    h2.settle(80);
    expect(() => budget.reserveHttp(10, "stage-3")).toThrow(OperationBudgetError);

    budget.reserveSignature("sig-1");
    expect(() => budget.reserveSignature("sig-2")).toThrow(OperationBudgetError);

    elapsed = 500;
    expect(() => budget.checkDeadline("late")).toThrow(OperationBudgetError);
  });

  test("ResolutionBudget enforces client/origin quotas, concurrency caps and releases permits", async () => {
    let nowMs = 1000;
    const budget = new ResolutionBudget(
      {
        windowMs: 60_000,
        client: { attempts: 3, bytes: 1024 },
        origin: { attempts: 3, bytes: 1024 },
        maxBuckets: 8,
        maxConcurrentTotal: 2,
        maxConcurrentPerClient: 1,
        maxConcurrentPerOrigin: 2,
      },
      () => nowMs,
    );

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    const slowFetcher = async () => {
      await firstGate;
      return { ok: true, status: 200, text: "abc" };
    };
    const fastFetcher = async () => ({ ok: true, status: 200, text: "abc" });
    const ctx = { clientBucket: "unknown", directoryOrigin: "https://agent.org", stage: "directory" as const };

    const inflight = budget.fetch(ctx, "https://agent.org/dir", slowFetcher, { maxBytes: 128 });
    // Second concurrent request from same client hits maxConcurrentPerClient (429)
    const concurrentDenied = await budget.fetch(ctx, "https://agent.org/dir", fastFetcher, { maxBytes: 128 });
    expect(concurrentDenied).toMatchObject({ ok: false, error: "client_budget_exhausted", status: 429 });

    releaseFirst();
    expect((await inflight).ok).toBe(true);
    expect(budget.stateForTests().activeTotal).toBe(0);

    // Exhaust attempts
    expect((await budget.fetch(ctx, "https://agent.org/dir", fastFetcher, { maxBytes: 128 })).ok).toBe(true);
    expect((await budget.fetch(ctx, "https://agent.org/dir", fastFetcher, { maxBytes: 128 })).ok).toBe(true);
    const exhausted = await budget.fetch(ctx, "https://agent.org/dir", fastFetcher, { maxBytes: 128 });
    expect(exhausted).toMatchObject({ ok: false, error: "client_budget_exhausted", status: 429 });

    // Next window resets counters
    nowMs += 60_000;
    expect((await budget.fetch(ctx, "https://agent.org/dir", fastFetcher, { maxBytes: 128 })).ok).toBe(true);
  });

  test("IdleBucketIndex evicts lowest-usage entries deterministically", () => {
    const idx = new IdleBucketIndex();
    idx.set({ key: "b", attempts: 2, bytes: 100, order: 1 });
    idx.set({ key: "a", attempts: 1, bytes: 500, order: 2 });
    expect(idx.pop()).toBe("a");
    expect(idx.pop()).toBe("b");
    expect(idx.pop()).toBeUndefined();
  });

  test("hashClientIpBuckets computes rotating HMAC buckets without reading headers", async () => {
    __resetResolutionHmacDayForTests();
    const secret = "a".repeat(32);
    const prev = "b".repeat(32);
    const buckets = await hashClientIpBuckets("::ffff:203.0.113.5", { secret, previousSecret: prev, now: 86_400_000 });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashClientIpBuckets("invalid", { secret })).toEqual(["unknown"]);
    expect(await hashClientIpBuckets("1.1.1.1", { secret: "short" })).toEqual(["unknown"]);
  });

  test("neutral client-IP and trusted-proxy chain resolution", () => {
    expect(normalizeClientIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeClientIp("  [2001:db8::1] ")).toBe("2001:db8::1");
    expect(normalizeClientIp("not-an-ip")).toBeNull();

    const trusted = parseTrustedProxies("127.0.0.1, ::ffff:10.0.0.1, invalid");
    expect(trusted).toEqual(["127.0.0.1", "10.0.0.1"]);

    // Untrusted peer ignores X-Forwarded-For
    expect(resolveClientIpFromProxyChain("198.51.100.2", "1.2.3.4", trusted)).toBe("198.51.100.2");
    // Trusted peer walks right-to-left skipping trusted proxies
    expect(resolveClientIpFromProxyChain("127.0.0.1", "1.2.3.4, 5.6.7.8, 10.0.0.1", trusted)).toBe("5.6.7.8");
    // Protocol resolution
    expect(resolveForwardedProtocol("127.0.0.1", "https", trusted, "http://local.test")).toBe("https");
    expect(resolveForwardedProtocol("198.51.100.2", "https", trusted, "http://local.test")).toBe("http");
    expect(resolveForwardedProtocol("198.51.100.2", "http", trusted, "https://public.test")).toBe("https");
  });
});
