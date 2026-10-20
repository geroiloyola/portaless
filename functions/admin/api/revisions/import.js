import { createPageStore } from "../../../../packages/atomic-elements/src/persistence/store-factory.ts";
import { readBodyLimited, RequestBodyTooLargeError } from "../../../_shared/read-body-limited.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export async function onRequestPost(context) {
  const user = context.data?.user;
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
  if (user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });

  let raw;
  try {
    raw = await readBodyLimited(context.request, MAX_IMPORT_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "revision_history_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
    return Response.json({ error: "invalid_json_body" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  let history;
  try {
    history = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json_body" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const pageStore = await createPageStore(context.env);
    const layout = await pageStore.importPublicRevisionHistory?.(history);
    if (!layout) return Response.json({ error: "revision_history_import_unavailable" }, { status: 501, headers: { "cache-control": "no-store" } });
    return Response.json({
      ok: true,
      publicationId: layout.publicationId,
      revisionId: layout.revisionId,
      revisionNo: layout.revisionNo,
      slug: layout.slug,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = String(error?.message ?? "");
    if (message === "publication_already_exists") {
      return Response.json({ error: message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    if (message === "invalid_revision_history" || message === "revision_content_hash_mismatch" || message.startsWith("invalid_revision_layout:")) {
      return Response.json({ error: message.split(":")[0] }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    console.error("[revision history import] failed:", message);
    return Response.json({ error: "revision_history_import_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
