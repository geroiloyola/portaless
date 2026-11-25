// Cloudflare Pages Function -- GET/HEAD /healthz
// Liveness probe with constant body ("ok"), status 200, no DB, no env, no
// identity, no counts, no version, no internal state (starter-and-demo-split.md §6).

const HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

export async function onRequestGet() {
  return new Response("ok", { status: 200, headers: HEADERS });
}

export async function onRequestHead() {
  return new Response(null, { status: 200, headers: HEADERS });
}

export async function onRequest() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      ...HEADERS,
      allow: "GET, HEAD",
    },
  });
}
