import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory.ts";
import { diffPageLayouts } from "../../../packages/atomic-elements/src/persistence/revision-diff.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function authorized(user) {
  if (!user) return respond({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return respond({ error: "forbidden" }, 403);
  return null;
}

export async function onRequestGet(context) {
  const { data, request, env } = context;
  const denied = authorized(data?.user);
  if (denied) return denied;
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || slug.length > 200) return respond({ error: "invalid_slug" }, 400);

  const store = await createPageStore(env);
  if (!store.listPendingRevisions) return respond({ error: "revision_proposals_unavailable" }, 501);
  const [proposals, publicHistory, current] = await Promise.all([
    store.listPendingRevisions(slug),
    store.listPublicRevisions?.(slug) ?? Promise.resolve([]),
    store.load(slug),
  ]);
  const pending = proposals.map((proposal) => {
    const base = publicHistory.find((revision) => revision.revisionId === proposal.baseRevisionId)?.layout
      ?? (current?.revisionId === proposal.baseRevisionId ? current : null);
    const diff = base ? diffPageLayouts(base, proposal.layout) : null;
    return {
      slug,
      publicationId: proposal.publicationId,
      revisionId: proposal.revisionId,
      revisionNo: proposal.revisionNo,
      baseRevisionId: proposal.baseRevisionId,
      contentHash: proposal.contentHash,
      createdAt: proposal.createdAt,
      stale: current?.revisionId !== proposal.baseRevisionId,
      diff: diff?.changes ?? null,
      diffTruncated: diff?.truncated ?? false,
    };
  });
  return respond({ slug, proposals: pending });
}

export async function onRequestPost(context) {
  const { data, request, env } = context;
  const denied = authorized(data?.user);
  if (denied) return denied;

  let input;
  try { input = await request.json(); } catch { return respond({ error: "invalid_json_body" }, 400); }
  if (typeof input?.slug !== "string" || !input.slug || input.slug.length > 200 ||
      typeof input?.revisionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.revisionId)) {
    return respond({ error: "invalid_approval_request" }, 400);
  }
  const store = await createPageStore(env);
  if (!store.approveRevision) return respond({ error: "revision_approval_unavailable" }, 501);
  try {
    const revision = await store.approveRevision(input.slug, input.revisionId, data.user.username);
    await emitActivity(env, {
      kind: "page.approved",
      actor: data.user.username,
      subject: input.slug,
      detail: `revision:${revision.revisionId}`,
    });
    return respond({ ok: true, ...revision });
  } catch (error) {
    if (["revision_conflict", "revision_not_found", "revision_already_approved", "revision_not_approvable"].includes(error?.message)) {
      return respond({ error: error.message }, error.message === "revision_conflict" ? 409 : 422);
    }
    throw error;
  }
}
