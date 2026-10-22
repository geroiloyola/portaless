import { describe, expect, it } from "vitest";
import { onRequest } from '../../functions/_middleware';

function make(request, env) {
  const data = {};
  let nextCalls = 0;
  const context = {
    request,
    env,
    data,
    async next() {
      nextCalls += 1;
      return new Response(`after-${nextCalls}`);
    },
  };
  return { context, state: { get nextCalls() { return nextCalls; } } };
}

describe("middleware redirects (B4)", () => {
  it("does not trust a manipulated Host for legacy 301s", async () => {
    const request = new Request("https://site.example/paginas/bio/", {
      headers: { host: "evil.example" },
    });
    const { context } = make(request, { PORTALESS_BASE_PATH: "/portaless" });
    const res = await onRequest(context);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/portaless/pages/bio/");
  });

  it("treats /portaless-evil as outside the configured base path", async () => {
    const request = new Request("https://site.example/portaless-evil/paginas/bio/");
    const { context, state } = make(request, { PORTALESS_BASE_PATH: "/portaless" });
    const res = await onRequest(context);
    expect(state.nextCalls).toBe(1);
  });
});
