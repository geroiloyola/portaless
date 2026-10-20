import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { projectPublicRevisionHistory } from "../../packages/atomic-elements/src/persistence/public-revision-history";
import { onRequestGet } from "../../functions/revisions/[publicationId]/index.json.js";

function databasePath() {
  return join(mkdtempSync(join(tmpdir(), "portaless-public-history-")), "node.sqlite");
}

describe("GET /revisions/:publicationId", () => {
  it("publica solo revisiones aprobadas y no contiene campos privados", async () => {
    const path = databasePath();
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    await store.save({ version: "0.1", slug: "publica", title: "Primera", status: "published", root: [] }, { expectedRevisionId: null, actor: "admin-private-name" });
    const first = await store.load("publica");
    await store.save({ ...first!, title: "Segunda" }, { expectedRevisionId: first!.revisionId, actor: "admin-private-name" });
    const latest = await store.load("publica");
    await store.save({ ...latest!, title: "Solo privado", status: "private" }, { expectedRevisionId: latest!.revisionId, actor: "admin-private-name" });

    const response = await onRequestGet({
      params: { publicationId: latest!.publicationId },
      env: { PORTALESS_SQLITE_PATH: path },
    } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    const json = await response.json();
    expect(json.format).toBe("portaless-public-revision-history/v1");
    expect(json.revisions.map((revision: any) => revision.title)).toEqual(["Segunda", "Primera"]);
    expect(JSON.stringify(json)).not.toContain("Solo privado");
    expect(JSON.stringify(json)).not.toContain("admin-private-name");
    expect(json.revisions[0].parentRevisionId).toBe(json.revisions[1].revisionId);
    expect(json.revisions[0].reputation).toEqual({ status: "no_data", observations: [] });
  });

  it("no encuentra publicaciones sin ninguna revisión aprobada ni IDs inválidos", async () => {
    const path = databasePath();
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    await store.save({ version: "0.1", slug: "privada", title: "Privada", status: "private", root: [] }, { expectedRevisionId: null });
    const privateHead = await store.load("privada");
    const noPublicHistory = await onRequestGet({
      params: { publicationId: privateHead!.publicationId },
      env: { PORTALESS_SQLITE_PATH: path },
    } as any);
    expect(noPublicHistory.status).toBe(404);
    const invalid = await onRequestGet({ params: { publicationId: "../../private" }, env: {} } as any);
    expect(invalid.status).toBe(404);
  });

  it("importa una proyección pública conservando publicación, revisiones y hashes entre nodos", async () => {
    const source = await createPageStore({ PORTALESS_SQLITE_PATH: databasePath() });
    await source.save({ version: "0.1", slug: "portable", title: "v1", status: "published", root: [] }, { expectedRevisionId: null, actor: "private-admin" });
    const v1 = await source.load("portable");
    const evidence = {
      evidenceId: "8a0b7e78-09f3-4ad9-977b-d9fe9dbe78e5",
      revisionId: v1!.revisionId!,
      observedAt: "2026-10-20T10:00:00.000Z",
      recordedAt: "2026-10-20T10:01:00.000Z",
      source: "https://evidence.example/observation/42",
      rulesVersion: "content-observation-v1",
      sampleSize: 4,
      weight: 1,
      calculation: { checksPassed: 4, checksTotal: 4 },
      proof: { sha256: "sha256:example-proof-digest" },
    };
    await source.recordPublicRevisionEvidence!(evidence);
    await source.save({ ...v1!, title: "v2" }, { expectedRevisionId: v1!.revisionId, actor: "private-admin" });
    const current = await source.load("portable");
    const portable = projectPublicRevisionHistory(await source.listPublicRevisionsByPublicationId!(current!.publicationId!));
    expect(portable?.revisions[0].reputation).toEqual({ status: "no_data", observations: [] });
    expect(portable?.revisions[1].reputation).toEqual({ status: "observed", observations: [evidence] });

    const destination = await createPageStore({ PORTALESS_SQLITE_PATH: databasePath() });
    const imported = await destination.importPublicRevisionHistory!(portable);
    expect(imported.publicationId).toBe(current!.publicationId);
    expect(imported.revisionId).toBe(current!.revisionId);
    expect(imported.contentHash).toBe(current!.contentHash);
    const copied = await destination.listPublicRevisionsByPublicationId!(current!.publicationId!);
    expect(copied.map((revision) => revision.revisionId)).toEqual([current!.revisionId, v1!.revisionId]);
    expect(copied[1].evidence).toEqual([evidence]);
    const next = await destination.save({ ...imported, title: "v3" }, { expectedRevisionId: imported.revisionId, actor: "new-admin" });
    expect(next.publicationId).toBe(current!.publicationId);
    expect(next.revisionNo).toBe(3);
    expect(next.parentRevisionId).toBe(current!.revisionId);
    expect((await destination.listPublicRevisionsByPublicationId!(current!.publicationId!))[2].evidence).toEqual([evidence]);
  });

  it("rechaza un manifiesto portable cuyo contenido ya no coincide con su hash", async () => {
    const source = await createPageStore({ PORTALESS_SQLITE_PATH: databasePath() });
    await source.save({ version: "0.1", slug: "tampered", title: "v1", status: "published", root: [] }, { expectedRevisionId: null });
    const current = await source.load("tampered");
    const portable = projectPublicRevisionHistory(await source.listPublicRevisionsByPublicationId!(current!.publicationId!))!;
    portable.revisions[0].layout.title = "altered";
    portable.revisions[0].title = "altered";
    const destination = await createPageStore({ PORTALESS_SQLITE_PATH: databasePath() });
    await expect(destination.importPublicRevisionHistory!(portable)).rejects.toThrow("revision_content_hash_mismatch");
    expect(await destination.load("tampered")).toBeNull();
  });
});
