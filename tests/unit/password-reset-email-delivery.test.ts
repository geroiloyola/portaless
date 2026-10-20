import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRequestPost as requestReset } from "../../functions/admin/password-reset/request";
import { onRequestPost as confirmReset } from "../../functions/admin/password-reset/confirm";
import { createUsersStore, createPasswordResetStore, createSessionStore } from "../../packages/auth/src/store-factory";
import { AuthService } from "../../packages/auth/src/auth-service";
import { openSqlite } from "../../packages/sqlite-driver/src/open";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-reset-delivery-"));
  dirs.push(dir);
  const env = {
    PORTALESS_SQLITE_PATH: join(dir, "auth.db"),
    PORTALESS_PUBLIC_URL: "https://portaless.example/base/",
    PORTALESS_EMAIL_WEBHOOK_URL: "https://mail.example.test/send",
    PORTALESS_EMAIL_WEBHOOK_TOKEN: "synthetic-test-token",
  };
  const users = await createUsersStore(env);
  await users.createUser("reset-recipient", "Old-Password-123!", "admin", "controlled@example.test");
  return { env, users };
}

function requestContext(url: string, env: Record<string, string>, body: unknown) {
  return {
    request: new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": crypto.randomUUID(),
        origin: new URL(url).origin,
      },
      body: JSON.stringify(body),
    }),
    env,
  } as any;
}

describe("password recovery email delivery", () => {
  it("rejects cross-origin reset requests before issuing a token", async () => {
    const { env } = await fixture();
    const response = await requestReset({
      request: new Request("https://portaless.example/admin/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ username: "reset-recipient" }),
      }),
      env,
    } as any);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "Origen de solicitud inválido." });
  });

  it("rejects oversized request bodies", async () => {
    const { env } = await fixture();
    const response = await requestReset({
      request: new Request("https://portaless.example/admin/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://portaless.example" },
        body: `{"username":"${"x".repeat(9 * 1024)}"}`,
      }),
      env,
    } as any);
    expect(response.status).toBe(413);
  });

  it("delivers a trusted reset link to the account email and completes the reset", async () => {
    const { env, users } = await fixture();
    let delivery: { to: string; subject: string; text: string } | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      delivery = JSON.parse(String(init.body));
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestReset(requestContext("https://portaless.example/admin/password-reset/request", env, {
      username: "reset-recipient",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(delivery?.to).toBe("controlled@example.test");
    const link = delivery?.text.match(/https:\/\/portaless\.example\/base\/admin\/password-reset\?token=[a-f0-9]+/)?.[0];
    expect(link).toBeTruthy();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer synthetic-test-token",
    });

    const token = new URL(link!).searchParams.get("token")!;
    const confirmed = await confirmReset(requestContext("https://portaless.example/admin/password-reset/confirm", env, {
      token,
      newPassword: "New-Password-123!",
    }));
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).success).toBe(true);
    expect((await new AuthService(users, await createSessionStore(env)).login("reset-recipient", "New-Password-123!")).success).toBe(true);
  });

  it("removes the reset token after a definitive provider rejection", async () => {
    const { env } = await fixture();
    let attemptedMessage: { text: string } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      attemptedMessage = JSON.parse(String(init.body));
      return new Response("rejected", { status: 400 });
    }));

    const response = await requestReset(requestContext("https://portaless.example/admin/password-reset/request", env, {
      username: "reset-recipient",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const token = new URL(attemptedMessage!.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get("token")!;
    const resets = await createPasswordResetStore(env);
    expect(await resets.consume(token)).toBeNull();
  });

  it("retains an unknown-outcome reset token and logs reconciliation without exposing it", async () => {
    const { env, users } = await fixture();
    let attemptedMessage: { text: string } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      attemptedMessage = JSON.parse(String(init.body));
      return new Response("provider unavailable", { status: 503 });
    }));

    const response = await requestReset(requestContext("https://portaless.example/admin/password-reset/request", env, {
      username: "reset-recipient",
    }));
    expect(await response.json()).toEqual({ success: true });
    const link = attemptedMessage!.text.match(/https:\/\/[^\s]+/)![0];
    const token = new URL(link).searchParams.get("token")!;
    const confirmed = await confirmReset(requestContext("https://portaless.example/admin/password-reset/confirm", env, {
      token,
      newPassword: "Accepted-After-Unknown-123!",
    }));
    expect(confirmed.status).toBe(200);
    expect((await new AuthService(users, await createSessionStore(env)).login("reset-recipient", "Accepted-After-Unknown-123!")).success).toBe(true);

    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    try {
      const event = db.prepare("SELECT kind, detail FROM activity_events WHERE kind='email.delivery.reconciliation_pending'").get();
      expect(event?.detail).toContain("password-reset");
      expect(event?.detail).not.toContain(token);
      expect(event?.detail).not.toContain("controlled@example.test");
    } finally {
      db.close();
    }
  });

  it("does not issue a reset token or reveal account existence without a mail backend", async () => {
    const { env } = await fixture();
    const noSenderEnv = { ...env, PORTALESS_EMAIL_WEBHOOK_URL: "", PORTALESS_EMAIL_WEBHOOK_TOKEN: "" };
    const response = await requestReset(requestContext("https://portaless.example/admin/password-reset/request", noSenderEnv, {
      username: "reset-recipient",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
