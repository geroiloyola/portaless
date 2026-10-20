import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../../functions/admin/_middleware.js";

function context(request: Request) {
  const next = vi.fn(async () => new Response("next"));
  return { ctx: { request, env: {}, data: {}, params: {}, next } as any, next };
}

describe("admin mutation origin/body guard", () => {
  it("rejects cross-origin state changes before opening auth stores", async () => {
    const { ctx, next } = context(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }));
    const response = await onRequest(ctx);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "invalid_request_origin" });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a same-origin mutation and lets the normal session guard run", async () => {
    const { ctx } = context(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example", "content-type": "application/json" },
      body: "{}",
    }));
    const response = await onRequest(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://site.example/admin/login?error=1");
  });

  it("rejects chunked/streamed bodies above the common admin ceiling", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const { ctx, next } = context(new Request("https://site.example/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://site.example", "content-type": "application/json" },
      body,
      // Node requires duplex for stream bodies; Cloudflare ignores this option.
      duplex: "half",
    } as RequestInit));
    const response = await onRequest(ctx);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
    expect(next).not.toHaveBeenCalled();
  });
});
