// Idempotent publication orchestration (C34).
//
// Rules enforced here:
//   - a run is bound to the exact site snapshot (slug -> approved revision);
//   - publishing the same successful snapshot is a no-op;
//   - a retry may only reuse the snapshot it started with (no stale republish);
//   - unpublish replaces the controlled public projection, it does not touch
//     the private canonical store;
//   - failures are recorded as stable codes, never provider bodies or tokens.

import type { PublicationRun, PublicationRunStore, PublicationRunStatus } from "./publication-store";
import type { PublicationSnapshot } from "./publication-snapshot";

export type PublicationStage = "building" | "deploying";

export interface PublicationResult {
  commitSha: string | null;
  pagesUrl: string | null;
}

export interface PublicationOrchestratorDeps {
  store: PublicationRunStore;
  publish: (snapshot: PublicationSnapshot, stage: (stage: PublicationStage) => Promise<void> | void) => Promise<PublicationResult>;
  retire: (run: PublicationRun) => Promise<PublicationResult>;
  now?: () => Date;
  id?: () => string;
  provider?: string;
}

export class PublicationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PublicationError";
  }
}

export interface PublicationOutcome {
  run: PublicationRun;
  idempotent: boolean;
}

export interface PublicationOrchestrator {
  status(siteId: string): Promise<{ latest: PublicationRun | null; published: PublicationRun | null }>;
  publish(snapshot: PublicationSnapshot): Promise<PublicationOutcome>;
  retry(siteId: string, runId: string, current: PublicationSnapshot): Promise<PublicationOutcome>;
  unpublish(siteId: string): Promise<PublicationOutcome>;
}

const ACTIVE: ReadonlySet<PublicationRunStatus> = new Set(["queued", "building", "deploying", "unpublishing"]);

function errorCode(err: unknown): string {
  if (err instanceof PublicationError) return err.code;
  return "publish_failed";
}

export function createPublicationOrchestrator(deps: PublicationOrchestratorDeps): PublicationOrchestrator {
  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? (() => globalThis.crypto.randomUUID());
  const provider = deps.provider ?? "github-pages";

  async function run(snapshot: PublicationSnapshot, attempts: number, existingId?: string): Promise<PublicationOutcome> {
    const timestamp = now().toISOString();
    const runId = existingId ?? id();
    const base: PublicationRun = existingId
      ? (await deps.store.get(existingId)) ?? {
          id: runId, siteId: snapshot.siteId, provider, snapshotHash: snapshot.hash,
          revisionIds: snapshot.revisionIds, status: "queued", attempts, startedAt: timestamp,
          finishedAt: null, errorCode: null, commitSha: null, pagesUrl: null,
        }
      : {
          id: runId, siteId: snapshot.siteId, provider, snapshotHash: snapshot.hash,
          revisionIds: snapshot.revisionIds, status: "queued", attempts, startedAt: timestamp,
          finishedAt: null, errorCode: null, commitSha: null, pagesUrl: null,
        };
    if (existingId) {
      await deps.store.update(runId, { status: "queued", attempts, finishedAt: null, errorCode: null });
    } else {
      await deps.store.create(base);
    }
    try {
      await deps.store.update(runId, { status: "building" });
      const result = await deps.publish(snapshot, async (stage) => {
        await deps.store.update(runId, { status: stage });
      });
      const finished = await deps.store.update(runId, {
        status: "published",
        finishedAt: now().toISOString(),
        commitSha: result.commitSha,
        pagesUrl: result.pagesUrl,
        errorCode: null,
      });
      return { run: finished!, idempotent: false };
    } catch (err) {
      const failed = await deps.store.update(runId, {
        status: "failed",
        finishedAt: now().toISOString(),
        errorCode: errorCode(err),
      });
      throw new PublicationError(errorCode(err), failed ? `Publication failed: ${errorCode(err)}` : "Publication failed");
    }
  }

  return {
    async status(siteId) {
      const [latest, published] = await Promise.all([
        deps.store.latest(siteId),
        deps.store.latestPublished(siteId),
      ]);
      return { latest, published };
    },

    async publish(snapshot) {
      if (Object.keys(snapshot.revisionIds).length === 0) {
        throw new PublicationError("snapshot_empty", "No approved public revisions to publish.");
      }
      const existing = await deps.store.findBySnapshot(snapshot.siteId, snapshot.hash);
      if (existing?.status === "published") return { run: existing, idempotent: true };
      if (existing && ACTIVE.has(existing.status)) return { run: existing, idempotent: true };
      return run(snapshot, (existing?.attempts ?? 0) + 1);
    },

    async retry(siteId, runId, current) {
      const existing = await deps.store.get(runId);
      if (!existing || existing.siteId !== siteId) throw new PublicationError("publication_not_found", "Publication run not found.");
      if (existing.status === "published") return { run: existing, idempotent: true };
      if (ACTIVE.has(existing.status)) return { run: existing, idempotent: true };
      if (existing.snapshotHash !== current.hash) {
        throw new PublicationError("stale_publication_snapshot", "The approved revision changed; start a new publication instead of retrying.");
      }
      return run(current, existing.attempts + 1, existing.id);
    },

    async unpublish(siteId) {
      const existing = await deps.store.latestPublished(siteId);
      if (!existing) throw new PublicationError("nothing_to_unpublish", "There is no published run to retire.");
      await deps.store.update(existing.id, { status: "unpublishing" });
      try {
        const result = await deps.retire(existing);
        const finished = await deps.store.update(existing.id, {
          status: "unpublished",
          finishedAt: now().toISOString(),
          commitSha: result.commitSha,
          pagesUrl: result.pagesUrl,
          errorCode: null,
        });
        return { run: finished!, idempotent: false };
      } catch (err) {
        await deps.store.update(existing.id, {
          status: "failed",
          finishedAt: now().toISOString(),
          errorCode: errorCode(err),
        });
        throw new PublicationError(errorCode(err), `Unpublish failed: ${errorCode(err)}`);
      }
    },
  };
}
