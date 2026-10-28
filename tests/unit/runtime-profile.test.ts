import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MINIMAL_RUNTIME_PROFILE, resolveMaxConcurrentRequests, validatePrivateNetworkProfile } from "../../packages/deploy-engine/src/runtime-profile";
import { evaluateResourceBudget, REFERENCE_RESOURCE_BUDGET } from "../../packages/deploy-engine/src/resource-budget";

const root = join(__dirname, "../..");

describe("C37/C38 private-node runtime profile", () => {
  it("bounds concurrency and rejects invalid values", () => {
    expect(resolveMaxConcurrentRequests(undefined)).toBe(64);
    expect(resolveMaxConcurrentRequests("8")).toBe(8);
    expect(() => resolveMaxConcurrentRequests("0")).toThrow(/between 1 and 1024/);
    expect(() => resolveMaxConcurrentRequests("many")).toThrow(/between 1 and 1024/);
  });

  it("requires an internal, portless private profile with optional tailscale", () => {
    expect(validatePrivateNetworkProfile({ publishedPorts: 0, internalNetwork: true, tailscaleOptional: true })).toEqual([]);
    expect(validatePrivateNetworkProfile({ publishedPorts: 1, internalNetwork: false, tailscaleOptional: false })).toEqual([
      "private profile must not publish app ports",
      "private profile must use an internal network",
      "tailscale must be an optional profile, not the default access path",
    ]);
    const compose = readFileSync(join(root, "docker-compose.private.yml"), "utf8");
    expect(compose).toContain("internal: true");
    expect(compose).toContain('profiles: ["tailscale"]');
    expect(compose.split("tailscale:")[0]).not.toMatch(/^\s+ports:/m);
  });

  it("N-01: every Compose profile requires PORTALESS_PUBLIC_URL explicitly", () => {
    for (const file of ["docker-compose.yml", "docker-compose.minimal.yml", "docker-compose.private.yml"]) {
      const compose = readFileSync(join(root, file), "utf8");
      expect(compose, file).toContain("PORTALESS_PUBLIC_URL: ${PORTALESS_PUBLIC_URL:?PORTALESS_PUBLIC_URL is required}");
      expect(compose, file).not.toContain(":-http://localhost:3000");
    }
  });

  it("declares the reference resource budget and evaluates measurements", () => {
    expect(MINIMAL_RUNTIME_PROFILE.diskBudgetBytes).toBe(20 * 1024 * 1024 * 1024);
    expect(REFERENCE_RESOURCE_BUDGET).toEqual({ rssBytes: 2 * 1024 * 1024 * 1024, diskBytes: 20 * 1024 * 1024 * 1024 });
    expect(evaluateResourceBudget({ rssBytes: 1024, databaseBytes: 2048, backupBytes: 4096 }).ok).toBe(true);
    expect(evaluateResourceBudget({ rssBytes: REFERENCE_RESOURCE_BUDGET.rssBytes + 1, databaseBytes: 1, backupBytes: 1 }).violations).toContain("ram_budget_exceeded");
    expect(evaluateResourceBudget({ rssBytes: 1, databaseBytes: REFERENCE_RESOURCE_BUDGET.diskBytes + 1, backupBytes: 1 }).violations).toContain("database_disk_budget_exceeded");
  });
});
