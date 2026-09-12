# Infraestructura: Cloudflare Pages

Notas de despliegue específicas de Cloudflare, complementarias a
`docs/DEPLOY_CLOUDFLARE_PAGES.md` (raíz del repo).

- Variables de entorno del proyecto de Pages: `PORTALESS_SITE_URL`,
  `ENABLE_COMMERCE`, `ENABLE_TRUST_LAYER`.
- Si en el futuro se activa el adaptador
  `CloudflareWorkersForPlatformsAdapter` (`packages/plugin-sandbox/`),
  este es el lugar para documentar la configuración del dispatch
  namespace y las credenciales de API necesarias.
