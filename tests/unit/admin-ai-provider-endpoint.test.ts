import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/admin/api/ai-provider.js";

function ctx(user: { role: string; username?: string } | null, env: Record<string, string> = {}) {
  return { data: { user }, env } as never;
}

describe("GET /admin/api/ai-provider", () => {
  it("requires an administrator", async () => {
    expect((await onRequestGet(ctx(null))).status).toBe(401);
    expect((await onRequestGet(ctx({ role: "viewer" }))).status).toBe(403);
  });

  it("returns the enabled profile but never the API key", async () => {
    const response = await onRequestGet(ctx({ role: "admin", username: "owner" }, {
      PORTALESS_OPENAI_API_KEY: "sk-server-secret",
      PORTALESS_OPENAI_BASE_URL: "https://provider.test/v1",
      PORTALESS_OPENAI_MODEL: "test-model",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      profile: { provider: "openai-compatible", baseUrl: "https://provider.test/v1", model: "test-model", apiKey: "server-side" },
      errors: [],
    });
    expect(JSON.stringify(body)).not.toContain("sk-server-secret");
  });

  it("reports configuration errors without pretending the provider is enabled", async () => {
    const response = await onRequestGet(ctx({ role: "admin" }, { PORTALESS_OPENAI_MODEL: "test-model" }));
    const body = await response.json();
    expect(body).toMatchObject({ enabled: false, profile: null });
    expect(body.errors).toContain("PORTALESS_OPENAI_API_KEY is required");
  });
});
