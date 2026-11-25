// Pure unit tests for all InMemory* store implementations in L1/L2 (no SQLite, no DB).
import { describe, expect, test } from "vitest";
import { InMemorySiteAtprotoLinksStore } from "@verared/apw/did-apw";
import { InMemoryReadPolicyStore } from "@verared/apw/scoring";
import { InMemoryCloudImageStore } from "@verared/cloud-images";
import { InMemorySettlementActivationStore } from "@verared/trust-layer/billing";
import {
  INVALID_RESOLUTION_BUDGET_CONFIG,
  InMemoryResolutionBudgetConfigStore,
  RESOLUTION_BUDGET_CONFIG_CONFLICT,
} from "@verared/trust-layer/net";
import { InMemoryAgentAccessPolicyStore, defaultAgentAccessPolicy } from "@verared/trust-layer/policy";
import { InMemoryWebBotAuthNonceStore } from "@verared/trust-layer";

describe("L1/L2 pure InMemory storage ports (zero SQLite)", () => {
  test("InMemorySiteAtprotoLinksStore: idempotent add, list, remove", async () => {
    const store = new InMemorySiteAtprotoLinksStore();
    const first = await store.add("default", "Alice.Example");
    const dup = await store.add("default", "alice.example");
    expect(dup).toEqual(first);
    expect(await store.list("default")).toHaveLength(1);
    expect(await store.remove("default", "ALICE.EXAMPLE")).toBe(true);
    expect(await store.remove("default", "alice.example")).toBe(false);
  });

  test("InMemoryReadPolicyStore: validates, saves and clones overrides", async () => {
    const store = new InMemoryReadPolicyStore();
    expect(await store.get("default")).toBeNull();
    const saved = await store.save({
      siteId: "default",
      enabled: true,
      minR01: 3.5,
      minR01Weight: 1,
      minR05: 4,
      minR05Weight: 0,
      publicOverrides: ["W-02"],
      onFail: "403",
      updatedBy: "admin",
    });
    expect(saved.requireApwIdentity).toBe(true);
    expect(saved.publicOverrides).toEqual(["W-02"]);
    expect((await store.get("default"))?.enabled).toBe(true);
  });

  test("InMemoryResolutionBudgetConfigStore: validates and enforces optimistic concurrency", async () => {
    const store = new InMemoryResolutionBudgetConfigStore();
    expect(await store.read()).toBeNull();
    const valid = {
      version: 1 as const,
      windowMs: 60_000,
      client: { attempts: 20, bytes: 1024 * 1024 },
      origin: { attempts: 10, bytes: 1024 * 1024 },
      maxBuckets: 256,
      maxConcurrentTotal: 8,
      maxConcurrentPerClient: 4,
      maxConcurrentPerOrigin: 4,
    };

    await expect(store.compareAndSet(null, { version: 2 }, "admin")).rejects.toThrow(INVALID_RESOLUTION_BUDGET_CONFIG);
    await expect(store.compareAndSet(1, valid, "admin")).rejects.toThrow(RESOLUTION_BUDGET_CONFIG_CONFLICT);

    const rev1 = await store.compareAndSet(null, valid, "admin");
    expect(rev1.revision).toBe(1);
    await expect(store.compareAndSet(null, valid, "admin")).rejects.toThrow(RESOLUTION_BUDGET_CONFIG_CONFLICT);

    const rev2 = await store.compareAndSet(1, { ...valid, maxBuckets: 512 }, "admin");
    expect(rev2.revision).toBe(2);
    expect((await store.read())?.config.maxBuckets).toBe(512);
    await expect(store.compareAndSet(1, valid, "admin")).rejects.toThrow(RESOLUTION_BUDGET_CONFIG_CONFLICT);
  });

  test("InMemoryWebBotAuthNonceStore: detects replay within TTL and expires after window", async () => {
    const store = new InMemoryWebBotAuthNonceStore();
    expect(await store.registerIfUnseen("n1", 1000, 300_000)).toBe(true);
    expect(await store.registerIfUnseen("n1", 2000, 300_000)).toBe(false);
    expect(await store.registerIfUnseen("n1", 301_000, 300_000)).toBe(true);
  });

  test("InMemorySettlementActivationStore & InMemoryAgentAccessPolicyStore CRUD", async () => {
    const act = new InMemorySettlementActivationStore();
    await act.save({
      providerId: "cloudflare-pay-per-crawl",
      credentialEnc: "enc",
      metadata: { zone: "z1" },
      verifiedAt: "2026-11-24T00:00:00.000Z",
      activatedBy: "admin",
    });
    expect((await act.get("cloudflare-pay-per-crawl"))?.metadata.zone).toBe("z1");
    await act.delete("cloudflare-pay-per-crawl");
    expect(await act.get("cloudflare-pay-per-crawl")).toBeNull();

    const pol = new InMemoryAgentAccessPolicyStore();
    const manifest = defaultAgentAccessPolicy("example.org");
    await pol.write(manifest, "admin");
    expect((await pol.read())?.policy.site).toBe("example.org");
    await pol.clear();
    expect(await pol.read()).toBeNull();
  });

  test("InMemoryCloudImageStore: rejects invalid sidecar cleanly", async () => {
    const store = new InMemoryCloudImageStore();
    await expect(
      store.put({
        bytes: new Uint8Array([1, 2, 3]),
        sidecar: {} as never,
        keyId: "k1",
      }),
    ).rejects.toThrow("invalid_sidecar");
  });
});
