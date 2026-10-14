// packages/posse-syndicator-plugin/src/plugin-entry.js
// Ejecutado dentro del sandbox aislado de Portaless.
// Las publicaciones canónicas residen en /posts/ (src/content/posts/*.md).

function formatBlueskyPost(post, siteUrl) {
  const base = String(siteUrl || "https://ejemplo.com").replace(/\/$/, "");
  const canonicalUrl = `${base}/blog/${encodeURIComponent(post.slug)}/`;
  const text = `${post.title}\n\n${post.excerpt || ""}\n\nLeído en el canon: ${canonicalUrl}`;
  return {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    facets: [
      {
        index: {
          byteStart: text.indexOf(canonicalUrl),
          byteEnd: text.indexOf(canonicalUrl) + canonicalUrl.length,
        },
        features: [
          {
            $type: "app.bsky.richtext.facet#link",
            uri: canonicalUrl,
          },
        ],
      },
    ],
  };
}

function formatMastodonPost(post, siteUrl) {
  const base = String(siteUrl || "https://ejemplo.com").replace(/\/$/, "");
  const canonicalUrl = `${base}/blog/${encodeURIComponent(post.slug)}/`;
  const status = `📝 ${post.title}\n\n${post.excerpt || ""}\n\nCanon: ${canonicalUrl}\n\n#portaless #posse`;
  return {
    status,
    visibility: "public",
  };
}

async function run() {
  switch (payload.action) {
    case "listTargets":
      return ["bluesky", "mastodon"];
    case "formatPayload":
      if (payload.target === "bluesky") {
        return formatBlueskyPost(payload.post, payload.siteUrl);
      } else if (payload.target === "mastodon") {
        return formatMastodonPost(payload.post, payload.siteUrl);
      }
      throw new Error(`Target POSSE no soportado: ${payload.target}`);
    default:
      throw new Error(`Acción desconocida en posse-syndicator-plugin: ${payload.action}`);
  }
}

run();
