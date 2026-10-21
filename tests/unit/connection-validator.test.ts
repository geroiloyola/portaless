import { describe, expect, it, vi } from "vitest";
import { checkCloudflareConnection, checkGitHubConnection, checkPrivateNode } from "../../packages/deploy-engine/src/connection-validator";

describe("C35 onboarding connection checks", () => {
  it("distinguishes a durable private node from a volatile one", () => {
    expect(checkPrivateNode({ backend: "sqlite", sqlitePath: "/data/portaless.db" })).toMatchObject({ status: "connected" });
    expect(checkPrivateNode({ backend: "d1" })).toMatchObject({ status: "connected" });
    expect(checkPrivateNode({ backend: "memory" })).toMatchObject({ status: "invalid" });
    expect(checkPrivateNode({ backend: "sqlite", sqlitePath: "/data/portaless.db", writable: false })).toMatchObject({ status: "invalid" });
  });

  it("validates GitHub with a read-only account call and never returns the token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ login: "owner" }), { status: 200 }));
    const check = await checkGitHubConnection(fetchImpl as never, "gho_secret");
    expect(check).toMatchObject({ status: "connected", account: "owner" });
    expect(JSON.stringify(check)).not.toContain("gho_secret");
    const rejected = await checkGitHubConnection((async () => new Response("{}", { status: 401 })) as never, "bad");
    expect(rejected.status).toBe("invalid");
    expect(await checkGitHubConnection(fetchImpl as never, null)).toMatchObject({ status: "not_configured" });
  });

  it("validates the Cloudflare Pages project, not just the token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const check = await checkCloudflareConnection(fetchImpl as never, { token: "cf-secret", accountId: "acc", project: "site" });
    expect(check).toMatchObject({ status: "connected", account: "acc" });
    expect(JSON.stringify(check)).not.toContain("cf-secret");
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.cloudflare.com/client/v4/accounts/acc/pages/projects/site");
    expect(await checkCloudflareConnection(fetchImpl as never, { token: null })).toMatchObject({ status: "not_configured" });
  });
});
