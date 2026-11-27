---
title: "Welcome to your Portaless site"
description: "Your first canonical Markdown post — comparing static Git publishing with a self-hosted Portaless node."
pubDate: 2026-11-25
---

# Welcome to your Portaless site

This is the single sample post included in the clean `starter` profile. Edit or replace it in `site-profiles/starter/posts/welcome.md` when you are ready to publish your own writing.

## Two publishing workflows

- **Static / Git workflow (zero runtime):** Edit Markdown posts in `site-profiles/starter/posts/`, edit your home page in `site-profiles/starter/home.json`, and compose pages in `site-profiles/starter/pages/` (start from `starter-guide.json`, rendered at `/pages/starter-guide/`). Build with `npm run build` and deploy the static HTML to GitHub Pages or Cloudflare Pages.
- **Self-hosted node (Node or Docker):** Run the self-hosted runtime to enable `/setup`, the visual editor under `/admin/`, MCP agent editing, approved-snapshot publishing, and the optional Trust Layer. Static hosts serve only the compiled HTML output and do not run `/admin/`.

## Next steps

- Inspect the single reference page at `/pages/starter-guide/` to see how `Visual Elements` blocks compose in JSON.
- Check `/explore/` to verify how your pages and posts are automatically indexed alongside `/rss.xml`, `/sitemap.xml`, and `/llms.txt`.
- To preview the full fictional showcase separately, visit the external live demo or build locally with `PORTALESS_SITE_PROFILE=demo`.
