import { describe, expect, it, vi } from "vitest";
import { assertSafeUrl, createSafeFetcher } from "../../packages/apw-resolver/src/federation/safe-fetch";
import { parseSignatureAgent } from "../../packages/trust-layer/src/webbotauth/headers";

function reject(url: string): Promise<unknown> {
  return assertSafeUrl(new URL(url), undefined);
}

describe("Web Bot Auth directory egress (SSRF)", () => {
  it("rejects only non-HTTPS Signature-Agent origins", () => {
    expect(parseSignatureAgent('"http://site.example"')).toBeNull();
    expect(parseSignatureAgent('"https://user:pass@site.example"')).toBeNull();
    expect(parseSignatureAgent('"https://site.example"')).not.toBeNull();
  });

  it("blocks key directory targets on loopback, private and metadata ranges", async () => {
    for (const url of [
      "https://127.0.0.1/.well-known/http-message-signatures-directory",
      "https://[::1]/.well-known/http-message-signatures-directory",
      "https://[::ffff:7f00:1]/.well-known/http-message-signatures-directory",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/.well-known/http-message-signatures-directory",
      "https://localhost/.well-known/http-message-signatures-directory",
    ]) {
      await expect(assertSafeUrl(new URL(url))).rejects.toThrow("blocked_host");
    }
  });

  it("blocks key directory targets that resolve to a private hop", async () => {
    const fetchMock = vi.fn();
    const safe = createSafeFetcher({ fetch: fetchMock, lookup: async () => ["10.0.0.5"] });
    const res = await safe("https://directory.example/.well-known/http-message-signatures-directory");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("blocked_host");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to 127.0.0.1 before connecting", async () => {
    const fetchPinned = vi.fn();
    const safe = createSafeFetcher({ lookup: async () => ["127.0.0.1"], fetchPinned });
    const res = await safe("https://rebind.example/.well-known/http-message-signatures-directory");
    expect(res).toMatchObject({ ok: false, error: "blocked_host" });
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to 169.254.169.254 before connecting", async () => {
    const fetchPinned = vi.fn();
    const safe = createSafeFetcher({ lookup: async () => ["169.254.169.254"], fetchPinned });
    const res = await safe("https://metadata.example/.well-known/http-message-signatures-directory");
    expect(res).toMatchObject({ ok: false, error: "blocked_host" });
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("pins the first validated address, so a second private resolution cannot rebind", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    const fetchPinned = vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    const safe = createSafeFetcher({ lookup, fetchPinned });

    const res = await safe("https://rebind.example/.well-known/http-message-signatures-directory");

    expect(res.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetchPinned).toHaveBeenCalledTimes(1);
    expect(fetchPinned.mock.calls[0][2]).toBe("93.184.216.34");
  });

  it("does not follow key directory redirects to a private hop", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://169.254.169.254/.well-known/http-message-signatures-directory" },
    }));
    const safe = createSafeFetcher({ fetch: fetchMock });
    const res = await safe("https://directory.example/.well-known/http-message-signatures-directory");
    expect(res.ok).toBe(false);
    expect(["blocked_host", "invalid_url"]).toContain(res.error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
