import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ResourceBudget, LtpFailure } from "../../packages/ltp-engine/src/budget";
import { acquireIdentity } from "../../packages/ltp-engine/src/acquisition";
import { runComposed } from "../../packages/ltp-engine/src/composed";
import { verifyHandoff } from "../../packages/ltp-engine/src/verification";
import {
  assertSafeEndpointUrl, isBlockedHostname, isBlockedIp, resolvePinnedAddress,
} from "../../packages/ltp-engine/src/ssrf";
import { FetchTransport, defaultOpen, type LtpTransport, type TransportRequest, type TransportResponse } from "../../packages/ltp-engine/src/transport";
import { FakeClock, ReplayTransport, loadCase, scriptedClock } from "../fixtures/ltp-v03";

const blockedIps = [
  "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
  "172.16.0.1", "192.0.2.10", "192.168.1.10", "198.18.0.1", "198.51.100.10",
  "203.0.113.10", "224.0.0.1", "240.0.0.1", "255.255.255.255",
  "::", "::1", "64:ff9b::7f00:1", "100::1", "2001:db8::1", "2002:7f00:1::1",
  "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
];
const allowedIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"];

class ThrowingTransport implements LtpTransport {
  readonly channel = "consumer-https-test";
  calls = 0;
  async send(_request: TransportRequest): Promise<TransportResponse> {
    this.calls += 1;
    throw new Error("simulated transport failure");
  }
}

class StaticTransport implements LtpTransport {
  readonly channel = "consumer-https-test";
  calls = 0;
  constructor(private readonly response: TransportResponse) {}
  async send(_request: TransportRequest): Promise<TransportResponse> {
    this.calls += 1;
    return this.response;
  }
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("SSRF destination policy", () => {
  test("blocks every special-use IPv4/IPv6 range, including mapped and NAT64 IPv4", () => {
    for (const address of blockedIps) expect(isBlockedIp(address), address).toBe(true);
    for (const address of allowedIps) expect(isBlockedIp(address), address).toBe(false);
  });

  test("blocks localhost and internal special-use hostnames", () => {
    for (const host of ["localhost", "foo.localhost", "api.local", "metadata.google.internal", "x.home.arpa", "a.test", "b.invalid", "c.example", "d.lan", "e.onion"]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
    for (const host of ["dns.google", "example.com", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedHostname(host), host).toBe(false);
    }
  });

  test("rejects plaintext, credentials, fragments, loopback and private literals before any DNS query", () => {
    expect(() => assertSafeEndpointUrl("http://dns.google/dns-query")).toThrow(/https/);
    expect(() => assertSafeEndpointUrl("https://user:pass@dns.google/dns-query")).toThrow(/userinfo/);
    expect(() => assertSafeEndpointUrl("https://dns.google/dns-query#fragment")).toThrow(/fragment/);
    expect(() => assertSafeEndpointUrl("https://127.0.0.1/dns-query")).toThrow(/blocked/);
    expect(() => assertSafeEndpointUrl("https://[::1]/dns-query")).toThrow(/blocked/);
    expect(() => assertSafeEndpointUrl("https://localhost/dns-query")).toThrow(/blocked/);
    expect(assertSafeEndpointUrl("https://dns.google/dns-query?name=_apw.example.com&type=TXT").hostname).toBe("dns.google");
  });

  test("normalizes trailing dots, uppercase, IDN/punycode and IPv6 zones without bypassing the blocklist", () => {
    for (const value of [
      "https://localhost./dns-query",
      "https://LOCALHOST/dns-query",
      "https://LOCALHOST./dns-query",
      "https://0.0.0.0/dns-query",
      "https://[fe80::1%25eth0]/dns-query",
    ]) {
      expect(() => assertSafeEndpointUrl(value), value).toThrow(/blocked|invalid/);
    }
    expect(() => assertSafeEndpointUrl("https://xn--bcher-kva.example/dns-query")).toThrow(/blocked/);
    expect(() => assertSafeEndpointUrl("https://bücher.example/dns-query")).toThrow(/blocked/);
    expect(assertSafeEndpointUrl("https://xn--bcher-kva.com/dns-query").hostname).toBe("xn--bcher-kva.com");
    expect(isBlockedIp("fe80::1%eth0")).toBe(true);
    expect(isBlockedHostname("localhost.")).toBe(true);
    expect(isBlockedHostname("LOCALHOST.")).toBe(true);
    expect(isBlockedHostname("xn--bcher-kva.example")).toBe(true);
    // `.example` is blocked for endpoints but must not be applied to a subject did.
    const bank = loadCase("AB-STATIC-01");
    expect(bank.subject()).toBe("did:apw:core.vector.example");
    expect(isBlockedHostname("core.vector.example")).toBe(true);
  });

  test("a single blocked DNS answer rejects the whole name instead of selecting a public address", async () => {
    await expect(resolvePinnedAddress("dns.google", async () => [
      { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
    ])).rejects.toThrow(/blocked/);
    await expect(resolvePinnedAddress("dns.google", async () => [{ address: "10.0.0.1", family: 4 }]))
      .rejects.toThrow(/blocked/);
    const pinned = await resolvePinnedAddress("dns.google", async () => [{ address: "8.8.8.8", family: 4 }]);
    expect(pinned).toEqual({ address: "8.8.8.8", family: 4 });
  });

  test("the verified address is pinned and the resolver is not consulted again before connect", async () => {
    let resolutions = 0;
    const seen: string[] = [];
    const transport = new FetchTransport({
      resolve: async () => {
        resolutions += 1;
        return [{ address: resolutions === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
      },
      open: async request => {
        seen.push(request.pinned.address);
        return { status: 200, headers: {}, body: new TextEncoder().encode("{}") };
      },
    });
    const response = await transport.send({
      method: "GET", url: "https://dns.google/dns-query?name=_apw.example.com", headers: {},
      maxBytes: 1024, timeoutMs: 1000, stage: "A-DOH",
    });
    expect(response.status).toBe(200);
    expect(resolutions).toBe(1);
    expect(seen).toEqual(["8.8.8.8"]);
  });

  test("loopback is rejected before the socket opens; a listening local server receives zero connections", async () => {
    let connections = 0;
    const server = createServer(socket => { connections += 1; socket.destroy(); });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const transport = new FetchTransport();
    await expect(transport.send({
      method: "GET", url: `https://127.0.0.1:${port}/dns-query`, headers: {},
      maxBytes: 1024, timeoutMs: 500, stage: "A-DOH",
    })).rejects.toThrow(/blocked/);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(connections).toBe(0);
  });
});

describe("live-like transport failure modes", () => {
  const base = {
    method: "GET" as const, url: "https://dns.google/dns-query?name=_apw.example.com",
    headers: {}, maxBytes: 1024, timeoutMs: 1000, stage: "A-DOH" as const,
  };
  const publicResolver = async () => [{ address: "8.8.8.8", family: 4 }];

  test("does not call the connector for a private DNS answer", async () => {
    let opens = 0;
    const transport = new FetchTransport({
      resolve: async () => [{ address: "169.254.169.254", family: 4 }],
      open: async () => { opens += 1; return { status: 200, headers: {}, body: new Uint8Array() }; },
    });
    await expect(transport.send(base)).rejects.toThrow(/blocked/);
    expect(opens).toBe(0);
  });

  test("rejects redirects instead of following them", async () => {
    const transport = new FetchTransport({
      resolve: publicResolver,
      open: async () => ({ status: 302, headers: { location: "https://127.0.0.1/" }, body: new Uint8Array() }),
    });
    await expect(transport.send(base)).rejects.toThrow(/redirect/);
  });

  test("rejects declared and streamed bodies above the cap", async () => {
    const declared = new FetchTransport({
      resolve: publicResolver,
      open: async () => ({ status: 200, headers: { "content-length": "2048" }, body: new Uint8Array(10) }),
    });
    await expect(declared.send(base)).rejects.toThrow(/cap/);
    const streamed = new FetchTransport({
      resolve: publicResolver,
      open: async () => ({ status: 200, headers: {}, body: new Uint8Array(2048) }),
    });
    await expect(streamed.send(base)).rejects.toThrow(/cap/);
  });

  test("the real TLS path rejects a self-signed certificate", async () => {
    const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
    if (openssl.status !== 0) return;
    const directory = mkdtempSync(join(tmpdir(), "ltp-tls-"));
    try {
      const key = join(directory, "key.pem");
      const cert = join(directory, "cert.pem");
      const generated = spawnSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=localhost", "-keyout", key, "-out", cert,
      ], { encoding: "utf8" });
      expect(generated.status, generated.stderr).toBe(0);
      const server = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, socket => socket.end());
      server.on("tlsClientError", () => {});
      servers.push(server as unknown as ReturnType<typeof createServer>);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as AddressInfo).port;
      await expect(defaultOpen({
        url: new URL(`https://localhost:${port}/`), method: "GET", headers: {},
        maxBytes: 1024, timeoutMs: 1000, pinned: { address: "127.0.0.1", family: 4 },
      })).rejects.toThrow(/transport failure/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a hanging connect is aborted by the shared deadline", async () => {
    const transport = new FetchTransport({
      resolve: publicResolver,
      open: () => new Promise(() => {}),
    });
    const started = Date.now();
    await expect(transport.send({ ...base, timeoutMs: 40 })).rejects.toThrow(/deadline/);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("fail-closed acquisition and budget stress with frozen bytes", () => {
  const baseInput = (bank: ReturnType<typeof loadCase>, transport: LtpTransport) => {
    const clock = new FakeClock(0);
    return {
      input: {
        subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1" as const,
        config: bank.config(), policy: bank.policy(), transport, now: clock.now,
        wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
        operationId: bank.initialState().context.operationId,
        clientScope: bank.initialState().context.clientScope,
      },
      clock,
    };
  };

  test("failed HTTP attempts keep the conservative body reservation and the attempt count", async () => {
    const bank = loadCase("AB-STATIC-01");
    const transport = new ThrowingTransport();
    const budget = new ResourceBudget(bank.limits(), () => 0);
    const outcome = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport, now: () => 0, budget,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("service_unavailable");
    expect(transport.calls).toBe(1);
    expect(budget.httpAttemptsUsed).toBe(1);
    expect(budget.bodyBytesUsed).toBe(bank.limits().dohBytes);
    expect(budget.signatureAttemptsUsed).toBe(0);
  });

  test("a failed Ed25519 verification still consumes the signature attempt", async () => {
    const bank = loadCase("AB-STATIC-07");
    const clock = new FakeClock(0);
    const transport = new ReplayTransport(bank, clock);
    const acquisition = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport, now: clock.now,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(acquisition.ok).toBe(true);
    if (!acquisition.ok) return;
    const budget = new ResourceBudget(bank.limits(), () => 0);
    const verify = verifyHandoff({
      handoff: acquisition.handoff, budget, policy: bank.policy(),
      states: { initial: bank.initialState(), slices: bank.slices() },
      now: scriptedClock(bank.fixture.resourceFacts.verificationTimeline.map(entry => entry.elapsedMs)),
      wallAt: bank.verificationWall,
    });
    expect(verify.result.reason).toBe("bad_signature");
    expect(verify.result.signatureAttemptsConsumed).toBe(4);
    expect(budget.signatureAttemptsUsed).toBe(4);
  });

  test("an IP-literal subject is rejected before any endpoint call", async () => {
    const bank = loadCase("AB-STATIC-01");
    const transport = new StaticTransport({
      status: 200, tlsAuthenticated: true, channel: "test", resolverId: bank.config().resolverId,
      body: bank.refBytes(bank.fixture.A.transcripts[0].response.bodyByteRef),
    });
    const { input } = baseInput(bank, transport);
    const outcome = await acquireIdentity({ ...input, subject: "did:apw:127.0.0.1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("ssrf_blocked");
    expect(transport.calls).toBe(0);
  });

  test("configured endpoints cannot smuggle a query or plaintext scheme", async () => {
    const bank = loadCase("AB-STATIC-01");
    const transport = new StaticTransport({
      status: 200, tlsAuthenticated: true, channel: "test", resolverId: bank.config().resolverId,
      body: bank.refBytes(bank.fixture.A.transcripts[0].response.bodyByteRef),
    });
    const { input } = baseInput(bank, transport);
    const withQuery = await acquireIdentity({ ...input, config: { ...bank.config(), doh: "https://dns.google/dns-query?x=1" } });
    expect(withQuery.ok).toBe(false);
    if (!withQuery.ok) expect(withQuery.reason).toBe("unsupported_profile");
    const plaintext = await acquireIdentity({ ...input, config: { ...bank.config(), index: "http://index.example/resolve" } });
    expect(plaintext.ok).toBe(false);
    if (!plaintext.ok) expect(plaintext.reason).toBe("unsupported_profile");
    expect(transport.calls).toBe(0);
  });

  test("malformed live-like DoH JSON fails closed after exactly one hop", async () => {
    const bank = loadCase("AB-STATIC-01");
    const transport = new StaticTransport({
      status: 200, tlsAuthenticated: true, channel: "test",
      resolverId: bank.config().resolverId, body: new TextEncoder().encode("{not-json"),
    });
    const { input } = baseInput(bank, transport);
    const outcome = await acquireIdentity(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("bootstrap_unsupported");
      expect(outcome.consumed).toEqual([true, false]);
    }
    expect(transport.calls).toBe(1);
  });

  test("AD=false fails closed and never requests the package", async () => {
    const bank = loadCase("AB-STATIC-02");
    const dns = bank.refBytes(bank.fixture.A.transcripts[0].response.bodyByteRef);
    const transport = new StaticTransport({
      status: 200, tlsAuthenticated: true, channel: "test",
      resolverId: bank.config().resolverId, body: dns,
    });
    const { input } = baseInput(bank, transport);
    const outcome = await acquireIdentity(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("dnssec_required");
      expect(outcome.consumed).toEqual([true, false]);
    }
    expect(transport.calls).toBe(1);
  });

  test("http attempt exhaustion stops before the package request", async () => {
    const bank = loadCase("AB-STATIC-01");
    const config = { ...bank.config(), limits: { ...bank.limits(), httpAttempts: 1 } };
    const clock = new FakeClock(0);
    const outcome = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config, policy: bank.policy(), transport: new ReplayTransport(bank, clock), now: clock.now,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("budget_exhausted");
      expect(outcome.consumed).toEqual([true, false]);
    }
  });

  test("cumulative body cap rejects the package response", async () => {
    const bank = loadCase("AB-STATIC-01");
    const config = { ...bank.config(), limits: { ...bank.limits(), bodyBytes: 1000, dohBytes: 500 } };
    const clock = new FakeClock(0);
    const outcome = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config, policy: bank.policy(), transport: new ReplayTransport(bank, clock), now: clock.now,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("response_limit_exceeded");
  });

  test("a clock jump past the shared deadline aborts the second hop", async () => {
    const bank = loadCase("AB-STATIC-01");
    const dns = bank.refBytes(bank.fixture.A.transcripts[0].response.bodyByteRef);
    const transport = new StaticTransport({
      status: 200, tlsAuthenticated: true, channel: "test",
      resolverId: bank.config().resolverId, body: dns,
    });
    let now = 0;
    const outcome = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport,
      now: () => { now += 6000; return now; },
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("deadline_exceeded");
  });

  test("a signature-attempt cap fails closed during verification", async () => {
    const bank = loadCase("AB-STATIC-01");
    const clock = new FakeClock(0);
    const transport = new ReplayTransport(bank, clock);
    const acquisition = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport, now: clock.now,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(acquisition.ok).toBe(true);
    if (!acquisition.ok) return;
    const budget = new ResourceBudget({ ...bank.limits(), signatureAttempts: 2 }, () => 0);
    const verify = verifyHandoff({
      handoff: acquisition.handoff, budget, policy: bank.policy(),
      states: { initial: bank.initialState(), slices: bank.slices() },
      now: scriptedClock([300, 800]), wallAt: bank.verificationWall,
    });
    expect(verify.ok).toBe(false);
    expect(verify.result.reason).toBe("budget_exhausted");
    expect(verify.result.signatureAttemptsConsumed).toBe(2);
  });

  test("a clock jump during verification fails closed before promotion", async () => {
    const bank = loadCase("AB-STATIC-01");
    const clock = new FakeClock(0);
    const transport = new ReplayTransport(bank, clock);
    const acquisition = await acquireIdentity({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport, now: clock.now,
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
    });
    expect(acquisition.ok).toBe(true);
    if (!acquisition.ok) return;
    const verify = verifyHandoff({
      handoff: acquisition.handoff, budget: new ResourceBudget(bank.limits(), () => 0), policy: bank.policy(),
      states: { initial: bank.initialState(), slices: bank.slices() },
      now: scriptedClock([10001]), wallAt: bank.verificationWall,
    });
    expect(verify.ok).toBe(false);
    expect(verify.result.reason).toBe("deadline_exceeded");
    expect(verify.result.proofAccepted).toBe(false);
  });

  test("the full composed run still succeeds with the real policy after hardening", async () => {
    const bank = loadCase("AB-STATIC-01");
    const clock = new FakeClock(0);
    const outcome = await runComposed({
      subject: bank.subject(), requestId: bank.requestId(), bootstrapProfile: "independent-doh-ad-v1",
      config: bank.config(), policy: bank.policy(), transport: new ReplayTransport(bank, clock), now: clock.now,
      verificationNow: scriptedClock(bank.fixture.resourceFacts.verificationTimeline.map(entry => entry.elapsedMs)),
      wallClockSeconds: bank.fixture.clock.acquisitionWallSeconds,
      operationId: bank.initialState().context.operationId, clientScope: bank.initialState().context.clientScope,
      states: { initial: bank.initialState(), slices: bank.slices() }, wallAt: bank.verificationWall,
    });
    expect(outcome.result.reason).toBeNull();
    expect(outcome.result.proofAccepted).toBe(true);
  });
});
