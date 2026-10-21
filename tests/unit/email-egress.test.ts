import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeEmailHost,
  normalizeWebhookUrl,
  sanitizeEmailInput,
} from "../../packages/email-transport/src/config";
import { sendViaWebhook } from "../../packages/email-transport/src/send";
import { HttpWebhookEmailSender } from "../../packages/auth/src/email-sender";

afterEach(() => vi.unstubAllGlobals());

describe("email destination normalization and egress", () => {
  it("normalizes DNS hostnames and rejects URL syntax in SMTP host fields", () => {
    expect(normalizeEmailHost("  SMTP.Example.COM. ")).toBe("smtp.example.com");
    expect(normalizeEmailHost("smtp.example.com:587")).toBeNull();
    expect(normalizeEmailHost("https://smtp.example.com")).toBeNull();
    expect(normalizeEmailHost("smtp.example.com\r\nMAIL FROM:<x>")).toBeNull();
  });

  it("rejects private IPv4-mapped IPv6 literals and loopback", () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:100.64.0.1]/",
      "http://[::1]/",
      "http://[::]/",
    ]) {
      expect(normalizeWebhookUrl(url), url).toBeNull();
    }
    expect(normalizeWebhookUrl("https://[::ffff:8.8.8.8]/")).not.toBeNull();
  });

  it("requires HTTPS when a webhook credential is configured", () => {
    expect(normalizeWebhookUrl("http://hooks.example.test/send", true)).toBeNull();
    expect(normalizeWebhookUrl("https://hooks.example.test./send", true)).toBe("https://hooks.example.test/send");
    expect(sanitizeEmailInput({
      provider: { kind: "webhook", url: "http://hooks.example.test/send", token: "secret" },
      from: "sender@example.test",
      templates: [],
    }).rejected).toContain("provider.url: se requiere una URL publica valida; si usa credenciales, debe ser HTTPS.");
  });

  it("does not follow or forward a webhook credential across redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://other.example.test/collect" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendViaWebhook(
      { kind: "webhook", url: "https://hooks.example.test/send", token: "synthetic-secret" },
      { from: "sender@example.test", to: "recipient@example.test", subject: "Test", text: "Body" },
    )).rejects.toThrow(/redirecciones están deshabilitadas/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("classifies explicit 4xx rejection separately from 5xx and connection ambiguity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rejected", { status: 400 })));
    await expect(sendViaWebhook(
      { kind: "webhook", url: "https://hooks.example.test/send" },
      { from: "sender@example.test", to: "recipient@example.test", subject: "Test", text: "Body" },
    )).rejects.toMatchObject({ deliveryOutcome: "rejected" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("unknown", { status: 503 })));
    await expect(sendViaWebhook(
      { kind: "webhook", url: "https://hooks.example.test/send" },
      { from: "sender@example.test", to: "recipient@example.test", subject: "Test", text: "Body" },
    )).rejects.toMatchObject({ deliveryOutcome: "unknown" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connection closed"); }));
    await expect(sendViaWebhook(
      { kind: "webhook", url: "https://hooks.example.test/send" },
      { from: "sender@example.test", to: "recipient@example.test", subject: "Test", text: "Body" },
    )).rejects.toMatchObject({ deliveryOutcome: "unknown" });
  });

  it("applies the same no-redirect policy to authentication webhooks", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://other.example.test/" } }));
    vi.stubGlobal("fetch", fetchMock);
    const sender = new HttpWebhookEmailSender("https://hooks.example.test/send", "synthetic-secret");
    await expect(sender.send({ to: "recipient@example.test", subject: "Reset", text: "Link" })).rejects.toThrow(/redirects are disabled/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
