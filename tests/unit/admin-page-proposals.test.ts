import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { onRequestGet, onRequestPost } from "../../functions/admin/api/page-proposals.js";

const dirs: string[] = [];
function env() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-page-proposals-"));
  dirs.push(dir);
  return { PORTALESS_SQLITE_PATH: join(dir, "pages.sqlite") };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function ctx({ user, env: bindings, slug = "home", revisionId, url }: {
  user: { username: string; role: string } | null;
  env: { PORTALESS_SQLITE_PATH: string };
  slug?: string;
  revisionId?: string;
  url?: string;
}) {
  return {
    data: { user },
    env: bindings,
    request: new Request(url ?? "https://portaless.test/admin/api/page-proposals?slug=home", {
      method: revisionId ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(revisionId ? { body: JSON.stringify({ slug, revisionId }) } : {}),
    }),
  } as never;
}

describe("admin proposal review endpoint", () => {
  it("requires an admin and approves only the reviewed revision id", async () => {
    const bindings = env();
    const pages = await createPageStore(bindings);
    const base = await pages.save({ version: "0.1", slug: "home", title: "v1", status: "published", root: [] }, { expectedRevisionId: null, actor: "owner" });
    const proposal = await pages.saveProposal!({ version: "0.1", slug: "home", title: "v2", status: "draft", root: [] }, base.revisionId, "agent");

    expect((await onRequestGet(ctx({ user: null, env: bindings }))).status).toBe(401);
    expect((await onRequestGet(ctx({ user: { username: "viewer", role: "viewer" }, env: bindings }))).status).toBe(403);

    const list = await onRequestGet(ctx({ user: { username: "owner", role: "admin" }, env: bindings }));
    const payload = await list.json();
    expect(payload.proposals[0]).toMatchObject({ revisionId: proposal.revisionId, baseRevisionId: base.revisionId, stale: false });
    expect(payload.proposals[0].diff).toEqual([{ path: "title", before: "v1", after: "v2" }]);

    const approved = await onRequestPost(ctx({ user: { username: "owner", role: "admin" }, env: bindings, revisionId: proposal.revisionId }));
    expect(approved.status).toBe(200);
    expect(await pages.load("home")).toMatchObject({ title: "v2", status: "published", revisionId: proposal.revisionId });

    const duplicate = await onRequestPost(ctx({ user: { username: "owner", role: "admin" }, env: bindings, revisionId: proposal.revisionId }));
    expect(duplicate.status).toBe(422);
    expect(await duplicate.json()).toMatchObject({ error: "revision_already_approved" });
  });
});
