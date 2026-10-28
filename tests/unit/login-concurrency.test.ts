import { describe, expect, it } from "vitest";
import {
  __resetLoginConcurrencyForTests,
  loginConcurrencyLimit,
  loginQueueMax,
  loginQueueTimeoutMs,
  runWithLoginConcurrency,
} from "../../functions/_shared/login-concurrency.js";

describe("login scrypt concurrency", () => {
  it("defaults to 4 and clamps invalid values", () => {
    expect(loginConcurrencyLimit({})).toBe(4);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "1" })).toBe(1);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "0" })).toBe(4);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "999" })).toBe(4);
    expect(loginQueueMax({})).toBe(32);
    expect(loginQueueMax({ PORTALESS_LOGIN_QUEUE_MAX: "0" })).toBe(0);
    expect(loginQueueTimeoutMs({})).toBe(2000);
  });

  it("never runs more than PORTALESS_LOGIN_CONCURRENCY tasks at once", async () => {
    __resetLoginConcurrencyForTests();
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    };
    await Promise.all(
      Array.from({ length: 8 }, () => runWithLoginConcurrency({ PORTALESS_LOGIN_CONCURRENCY: "2" }, task))
    );
    expect(maxActive).toBe(2);
  });

  it("rejects with 503-compatible LoginBusyError when the queue is full", async () => {
    __resetLoginConcurrencyForTests();
    let release;
    const first = runWithLoginConcurrency(
      { PORTALESS_LOGIN_CONCURRENCY: "1", PORTALESS_LOGIN_QUEUE_MAX: "0" },
      () => new Promise((resolve) => { release = resolve; })
    );
    await expect(
      runWithLoginConcurrency(
        { PORTALESS_LOGIN_CONCURRENCY: "1", PORTALESS_LOGIN_QUEUE_MAX: "0" },
        async () => "should-not-run"
      )
    ).rejects.toMatchObject({ code: "login_busy", reason: "queue_full" });
    release("done");
    await expect(first).resolves.toBe("done");
  });

  it("rejects queued work that waits too long", async () => {
    __resetLoginConcurrencyForTests();
    let release;
    const first = runWithLoginConcurrency(
      { PORTALESS_LOGIN_CONCURRENCY: "1", PORTALESS_LOGIN_QUEUE_MAX: "1", PORTALESS_LOGIN_QUEUE_TIMEOUT_MS: "10" },
      () => new Promise((resolve) => { release = resolve; })
    );
    const queued = runWithLoginConcurrency(
      { PORTALESS_LOGIN_CONCURRENCY: "1", PORTALESS_LOGIN_QUEUE_MAX: "1", PORTALESS_LOGIN_QUEUE_TIMEOUT_MS: "10" },
      async () => "should-not-run"
    );
    await expect(queued).rejects.toMatchObject({ code: "login_busy", reason: "queue_timeout" });
    release("done");
    await expect(first).resolves.toBe("done");
  });
});
