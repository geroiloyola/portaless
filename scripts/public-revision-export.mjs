import fs from "node:fs";
import path from "node:path";
import { projectPublicRevisionHistory, validatePortablePublicRevisionHistory } from "../packages/atomic-elements/src/persistence/public-revision-history.ts";
import { isPubliclyPublishable } from "../packages/deploy-engine/src/draft-filter.ts";

/** Generate history from approved store rows, never copy a pre-existing tree. */
export async function writePublicRevisionHistories(stageRoot, layouts, pageStore) {
  for (const layout of layouts) {
    if (!isPubliclyPublishable(layout) || !layout.publicationId) continue;
    const revisions = await pageStore.listPublicRevisionsByPublicationId(layout.publicationId);
    // The build is pinned to the head loaded by the publisher. A later write
    // must not appear as the current revision of an older content artifact.
    const history = projectPublicRevisionHistory(revisions.filter((revision) => revision.revisionNo <= layout.revisionNo));
    if (!history || history.revisions[0].revisionId !== layout.revisionId || history.revisions[0].contentHash !== layout.contentHash) {
      throw new Error("public_revision_head_mismatch");
    }
    await validatePortablePublicRevisionHistory(history);
    const contentPath = path.join(stageRoot, "src/content/revision-history", `${history.publicationId}.json`);
    const publicPath = path.join(stageRoot, "public/revisions", history.publicationId, "index.json");
    for (const target of [contentPath, publicPath]) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(history, null, 2));
    }
  }
}
