// functions/index.js — Editable home page (/) with non-destructive static fallback.
//
// Serves GET / and HEAD / dynamically when a database is configured and a page
// with slug "home" exists in published status. When "home" is missing, still in
// draft/private status, or no database is configured, delegates cleanly to
// context.next() so the static dist/index.html (starter/demo) is served intact.
// Always runs behind functions/_middleware.js (Gatekeeper, B3, CSP, security headers).

import { renderDynamicPageResponse } from "./pages/[slug].js";

export async function onRequestGet(context) {
  return renderDynamicPageResponse(context, {
    slug: "home",
    canonicalPath: "/",
    fallbackOnNonPublic: true,
  });
}

export async function onRequestHead(context) {
  return renderDynamicPageResponse(context, {
    slug: "home",
    canonicalPath: "/",
    fallbackOnNonPublic: true,
  });
}
