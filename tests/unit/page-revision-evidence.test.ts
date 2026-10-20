import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { projectPublicRevisionHistory } from "../../packages/atomic-elements/src/persistence/public-revision-history";

const evidence = (revisionId: string, evidenceId: string, observedAt: string, rulesVersion: string) => ({
  evidenceId,
  revisionId,
  observedAt,
  recordedAt: "2026-10-20T11:00:00.000Z",
  source: "https://evidence.example/observations/real-source",
  rulesVersion,
  sampleSize: 3,
  weight: 0.75,
  calculation: { passed: 3, total: 3 },
  proof: { reference: "sha256:real-source-record" },
});

describe("revision-bound evidence", () => {
  it("appends observations to the exact approved revision without rewriting earlier evaluations", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "portaless-revision-evidence-")), "node.sqlite");
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    await store.save({ version: "0.1", slug: "evidence", title: "Evidence subject", status: "published", root: [] }, { expectedRevisionId: null });
    const head = await store.load("evidence");
    await store.recordPublicRevisionEvidence!(evidence(head!.revisionId!, "2b8602dc-8b90-47cc-9baf-884e2626814a", "2026-10-20T10:00:00.000Z", "rules-v1"));
    await store.recordPublicRevisionEvidence!(evidence(head!.revisionId!, "eab38c19-9098-4ae9-b4da-d83d84663bd4", "2026-10-20T10:30:00.000Z", "rules-v2"));

    const history = projectPublicRevisionHistory(await store.listPublicRevisionsByPublicationId!(head!.publicationId!));
    expect(history?.revisions[0].revisionId).toBe(head!.revisionId);
    expect(history?.revisions[0].reputation.status).toBe("observed");
    if (history?.revisions[0].reputation.status !== "observed") throw new Error("expected observations");
    expect(history.revisions[0].reputation.observations.map((item) => item.rulesVersion)).toEqual(["rules-v1", "rules-v2"]);
    expect(history.revisions[0].reputation.observations[0].sampleSize).toBe(3);
  });

  it("does not accept evidence for a draft revision", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "portaless-revision-evidence-")), "node.sqlite");
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    await store.save({ version: "0.1", slug: "draft-evidence", title: "Draft", status: "draft", root: [] }, { expectedRevisionId: null });
    const head = await store.load("draft-evidence");
    await expect(store.recordPublicRevisionEvidence!(evidence(head!.revisionId!, "1a07c3e5-a6a9-4558-aae8-d49aac0d0a71", "2026-10-20T10:00:00.000Z", "rules-v1")))
      .rejects.toThrow("revision_not_public");
  });
});
