import { describe, expect, it, vi } from "vitest";
import { createPublicationOrchestrator, PublicationError } from "../../packages/deploy-engine/src/publication-orchestrator";
import { InMemoryPublicationRunStore } from "../../packages/deploy-engine/src/publication-store";
import type { PublicationSnapshot } from "../../packages/deploy-engine/src/publication-snapshot";

const SNAPSHOT: PublicationSnapshot = { siteId: "default", revisionIds: { home: "rev-1" }, hash: "sha256:abc" };

function setup(overrides: { publish?: any; retire?: any } = {}) {
  const store = new InMemoryPublicationRunStore();
  const publish = overrides.publish ?? vi.fn(async () => ({ commitSha: "commit-1", pagesUrl: "https://example.test/" }));
  const retire = overrides.retire ?? vi.fn(async () => ({ commitSha: "commit-retire", pagesUrl: null }));
  let n = 0;
  const orchestrator = createPublicationOrchestrator({
    store,
    publish,
    retire,
    now: () => new Date(`2026-10-20T00:00:0${n++}.000Z`),
    id: () => `run-${n}`,
  });
  return { store, publish, retire, orchestrator };
}

describe("C34 publication orchestration", () => {
  it("publishes a snapshot once and treats the same approved snapshot as idempotent", async () => {
    const { publish, orchestrator } = setup();
    const first = await orchestrator.publish(SNAPSHOT);
    expect(first.run).toMatchObject({ status: "published", snapshotHash: SNAPSHOT.hash, commitSha: "commit-1" });
    expect(first.idempotent).toBe(false);
    const second = await orchestrator.publish(SNAPSHOT);
    expect(second.idempotent).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("refuses to retry a run whose approved snapshot changed", async () => {
    const { store, orchestrator } = setup({ publish: vi.fn(async () => { throw new Error("boom"); }) });
    const failed = await orchestrator.publish(SNAPSHOT).catch((error) => error);
    expect(failed).toBeInstanceOf(PublicationError);
    const latest = await store.latest("default");
    await expect(orchestrator.retry("default", latest!.id, { ...SNAPSHOT, hash: "sha256:changed" }))
      .rejects.toMatchObject({ code: "stale_publication_snapshot" });
  });

  it("retries the same snapshot after a failure", async () => {
    let attempts = 0;
    const publish = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network");
      return { commitSha: "commit-2", pagesUrl: "https://example.test/" };
    });
    const { store, orchestrator } = setup({ publish });
    await orchestrator.publish(SNAPSHOT).catch(() => {});
    const latest = await store.latest("default");
    const retried = await orchestrator.retry("default", latest!.id, SNAPSHOT);
    expect(retried.run).toMatchObject({ status: "published", attempts: 2, commitSha: "commit-2" });
  });

  it("unpublishes by replacing the controlled projection and never touches the snapshot", async () => {
    const { retire, orchestrator } = setup();
    await orchestrator.publish(SNAPSHOT);
    const outcome = await orchestrator.unpublish("default");
    expect(outcome.run.status).toBe("unpublished");
    expect(retire).toHaveBeenCalledOnce();
    expect(outcome.run.revisionIds).toEqual(SNAPSHOT.revisionIds);
  });

  it("rejects an empty approved snapshot", async () => {
    const { orchestrator } = setup();
    await expect(orchestrator.publish({ siteId: "default", revisionIds: {}, hash: "sha256:empty" }))
      .rejects.toMatchObject({ code: "snapshot_empty" });
  });
});
