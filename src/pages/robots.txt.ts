import type { APIRoute } from "astro";
import { getSiteUrl } from "../lib/seo";

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = getSiteUrl(site);
  const body = `User-agent: *
Disallow: /admin/
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
