# Runtime Parity Matrix (Static vs Cloudflare Pages vs Node Self-Host)

This document is the canonical feature-by-runtime parity matrix for Portaless (`E-05`).
It states explicitly what works in each target runtime today so operators never rely on
implicit assumptions. Every row is guarded by [`tests/unit/runtime-parity-matrix.test.ts`](../../tests/unit/runtime-parity-matrix.test.ts).

## Summary Matrix

| Capability | Static (`dist/` on GitHub Pages / CDN) | Cloudflare Pages (`functions/` + D1) | Node Self-Host (`server/node-runtime.mjs` + SQLite) | Code anchor |
|---|---|---|---|---|
| Public site (`starter` & `demo` profiles, `/`, `/pages/*`, `/blog/*`, `/explore/`, `/llms.txt`, `/rss.xml`, `/sitemap.xml`) | Supported | Supported | Supported | `astro.config.mjs`, `src/lib/site-profile.mjs` |
| Liveness `GET`/`HEAD /healthz` (constant `200 ok`, no DB/env) | N/A (static host) | Supported (`functions/healthz.js`, exact middleware exemption) | Supported (`server/node-runtime.mjs`) | `functions/healthz.js`, `functions/_middleware.js`, `server/node-runtime.mjs` |
| Security headers & strict CSP (`script-src 'self' https:`, zero `'unsafe-inline'`) | Supported (`public/_headers` on Cloudflare Pages / compatible CDNs; GitHub Pages ignores `_headers`) | Supported (`functions/_shared/security-headers.js` + `public/_headers`) | Supported (`server/node-runtime.mjs` via `withSecurityHeaders`) | `public/_headers`, `functions/_shared/security-headers.js`, `server/node-runtime.mjs` |
| Admin auth, MFA (TOTP), OAuth (`M-07`), Logout, Rate limits (`A-01`, `N-03`) | Unsupported (no runtime) | Supported (D1 stores) | Supported (SQLite stores) | `functions/admin/login.js`, `functions/admin/login-mfa.js`, `functions/admin/logout.js`, `functions/admin/oauth/[provider]/callback.js` |
| Step-up verification (password + TOTP + email OTP) | Unsupported | Supported (webhook email transport) | Supported (webhook or direct SMTP) | `functions/admin/api/stepup/email/request.js`, `packages/auth/src/auth-service.ts` |
| Auth email transport (`createEmailSender`) | Unsupported | Webhook HTTPS (`PORTALESS_EMAIL_WEBHOOK_URL`) | Webhook HTTPS or direct SMTP (`PORTALESS_EMAIL_SMTP_HOST`) | `packages/auth/src/email-sender.ts` |
| Persistence backend | None (build-time files only) | Cloudflare D1 (`env.DB`) | SQLite via `better-sqlite3` (`PORTALESS_SQLITE_PATH`, Node >= 24) | `packages/auth/src/store-factory.ts`, `schema.sql` |
| Terminal-less first-run `/setup` | Unsupported | Unsupported (`404`; use `npm run setup:d1`) | Supported (`server/first-run.mjs` + `POST /api/setup/complete`) | `server/first-run.mjs`, `functions/api/setup/complete.js` |
| Visual editor, approved publication & canonical SQLite backup | Unsupported | Partial (editor/API work; no child-process Astro rebuild or local SQLite backup) | Supported (full publish pipeline + checksummed SQLite backup/restore) | `functions/admin/api/publication.js`, `functions/admin/api/backup.js` |
| MCP server (19 tools, stdio + HTTP transport) | Unsupported | Unsupported | Supported (`npm run mcp` / `npm run mcp:http`) | `packages/mcp-server/src/index.ts` |
| Plugin Sandbox (`isolated-vm` + capability bridge) | Unsupported | Partial (edge adapters exist, unverified against real accounts) | Supported (`isolated-vm` pool, 7/12 real capabilities, 5 explicit `501`) | `packages/plugin-sandbox/`, `functions/api/internal/capability-bridge.js` |
| Trust Layer & Protocol APW (`/.well-known/*`, Web Bot Auth, SVRI, Witness & Index sync, Pay-per-crawl) | Partial (static `/robots.txt`, `/llms.txt` only) | Supported (D1 persistence; `nodejs_compat` enabled) | Supported (SQLite persistence; reference runtime) | `functions/_middleware.js`, `functions/.well-known/apw-index.json.js`, `functions/admin/api/witness/record.js`, `functions/admin/api/index/sync.js` |

## Honest runtime notes

1. **Static hosting (GitHub Pages):** Serves only the compiled HTML/CSS/JS output from `npm run build`. No `/admin/*` backend, no `/healthz` function, no database, and no server-side Trust Layer enforcement.
2. **Cloudflare Pages Functions:** Runs `functions/` with `nodejs_compat` (`wrangler.toml`) backed by D1 (`env.DB`). Direct SMTP (`PORTALESS_EMAIL_SMTP_HOST`), terminal-less `/setup`, child-process publication builds, and the `isolated-vm` plugin runtime require Node self-host.
3. **Node Self-Host (`server/node-runtime.mjs`):** Reference runtime for full functionality (all `functions/`, SQLite persistence, `/setup`, MCP server, publication orchestration, checksummed backup, and `isolated-vm` sandbox).
