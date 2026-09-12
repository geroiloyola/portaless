# Infraestructura: GitHub Pages

Notas de despliegue específicas de GitHub Pages, complementarias a
`docs/DEPLOY_GITHUB_PAGES.md` (raíz del repo) y al workflow
`.github/workflows/deploy-gh-pages.yml`.

GitHub Pages no soporta funciones edge (`functions/_middleware.js` del
Trust Layer no se ejecuta aquí) — para sitios que necesiten esa capa,
usar Cloudflare Pages en su lugar (ver `infra/cloudflare/`).
