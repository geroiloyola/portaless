import { describe, expect, it } from "vitest";
import { onRequestGet as status } from "../../functions/api/setup/status.js";
import { onRequestPost as complete } from "../../functions/api/setup/complete.js";

const url = "http://localhost/api/setup/complete";
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

describe("setup endpoints", () => {
  it("responden 404 sin servicio de primer arranque (Cloudflare Pages)", async () => {
    expect((await status({ env: {} } as any)).status).toBe(404);
    expect((await complete({ request: post("{}"), env: {} } as any)).status).toBe(404);
  });

  it("status expone solo needsSetup y keySourceWarning", async () => {
    const env = { __PORTALESS_FIRST_RUN: { status: () => ({ needsSetup: true, keySourceWarning: false, secret: "x" }) } };
    const res = await status({ env } as any);
    expect(await res.json()).toEqual({ needsSetup: true, keySourceWarning: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("complete rechaza JSON invalido y requests de otro origen", async () => {
    const env = { __PORTALESS_FIRST_RUN: { complete: async () => ({ status: 201, body: {} }) } };
    expect((await complete({ request: post("no-json"), env } as any)).status).toBe(400);
    expect((await complete({ request: post("{}", { origin: "https://evil.example" }), env } as any)).status).toBe(403);
  });

  it("complete delega en el servicio y propaga su status", async () => {
    let received: unknown;
    const env = { __PORTALESS_FIRST_RUN: { complete: async (input: unknown) => { received = input; return { status: 410, body: { success: false, error: "setup_disabled" } }; } } };
    const res = await complete({ request: post(JSON.stringify({ code: "C", username: "u", password: "p", role: "x" }), { origin: "http://localhost" }), env } as any);
    expect(res.status).toBe(410);
    expect(received).toEqual({ code: "C", username: "u", password: "p" });
  });
});
