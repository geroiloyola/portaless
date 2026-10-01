// GET /robots.txt -- UNICA fuente del archivo (PR F). Lo genera el Trust
// Layer con Content Signals a partir de public/.well-known/
// portaless-content-policy.json; si no existe o esta incompleto, usa
// defaultContentPolicy(). public/robots.txt se elimino para no tener dos
// archivos compitiendo por la misma ruta.
//
// Respeta el base de Astro en Disallow, Sitemap, llms.txt y la politica.

import type { APIRoute } from "astro";
import { getSiteUrl } from "../lib/seo";
import { joinSiteUrl } from "../lib/llms-txt";
import { CONTENT_POLICY_PATH, isCompleteManifest, readContentPolicyManifest } from "../lib/content-policy";
import { generateRobotsTxt } from "../../packages/trust-layer/src/policy/robots-generator";
import { defaultContentPolicy, type ContentPolicyManifest } from "../../packages/trust-layer/src/policy/manifest-schema";

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = getSiteUrl(site);
  const base = import.meta.env.BASE_URL;
  const url = (path: string) => joinSiteUrl(siteUrl, base, path);
  const basePrefix = `/${base}`.replace(/\/+/g, "/").replace(/\/$/, "");

  const raw = readContentPolicyManifest();
  let manifest: ContentPolicyManifest;
  if (raw && isCompleteManifest(raw)) {
    manifest = raw as ContentPolicyManifest;
  } else {
    if (raw) console.warn("[Portaless] portaless-content-policy.json incompleto: robots.txt usa la politica por defecto.");
    manifest = defaultContentPolicy(siteUrl);
  }

  const body = generateRobotsTxt(manifest, {
    disallow: [`${basePrefix}/admin/`],
    sitemapUrl: url("/sitemap.xml"),
    llmsTxtUrl: url("/llms.txt"),
    policyUrl: url(CONTENT_POLICY_PATH),
  });

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
