import { describe, expect, it } from "vitest";
import {
  __resetLoginConcurrencyForTests,
  loginConcurrencyLimit,
  runWithLoginConcurrency,
} from "../../functions/_shared/login-concurrency.js";

describe("login scrypt concurrency", () => {
  it("defaults to 4 and clamps invalid values", () => {
    expect(loginConcurrencyLimit({})).toBe(4);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "1" })).toBe(1);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "0" })).toBe(4);
    expect(loginConcurrencyLimit({ PORTALESS_LOGIN_CONCURRENCY: "999" })).toBe(4);
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
});
