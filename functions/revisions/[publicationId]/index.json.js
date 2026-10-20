import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory.ts";
import { projectPublicRevisionHistory, validatePortablePublicRevisionHistory } from "../../../packages/atomic-elements/src/persistence/public-revision-history.ts";

const PUBLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestGet(context) {
  const publicationId = context.params?.publicationId;
  if (!PUBLICATION_ID.test(publicationId ?? "")) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const env = context.env ?? {};
  if (!(env.DB || env.PORTALESS_DB || env.PORTALESS_SQLITE_PATH || env.PAGES_SQLITE_PATH)) {
    return context.next ? context.next() : new Response("Not Found", { status: 404 });
  }

  try {
    const pageStore = await createPageStore(context.env);
    const revisions = await pageStore.listPublicRevisionsByPublicationId?.(publicationId);
    const history = projectPublicRevisionHistory(revisions ?? []);
    if (!history) return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
    await validatePortablePublicRevisionHistory(history);
    return Response.json(history, {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[public revision history] read failed:", error?.message ?? error);
    return new Response("Revision history unavailable", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
