# Lecciones — primer arranque (PR B)

- Importar módulos con efectos secundarios rompe la reutilización: `scripts/setup.mjs` ejecutaba `main()` al importarse. Ahora solo corre como script.
- Poner las rutas públicas de bootstrap bajo `/admin/*` las atrapa en el middleware de sesión. `functions/admin/_middleware.js` solo excluye `/admin/login`, así que `/admin/api/wizard/admin-status`, `/admin/login-mfa` y `/admin/password-reset/*` reciben un 302 sin sesión. Es un bug pendiente para un PR aparte.
- La clave AES-GCM debe ir en Base64 estándar: `atob()` no acepta base64url.
- Pages Functions no puede importar `node:fs`. Las capacidades exclusivas de Node se inyectan desde el runtime como un objeto en `env`.
- `npm start` usa `node` directo, pero las functions importan `.ts` sin extensión y `site-identity-store.ts` usa parameter properties, que el strip-types nativo de Node 24 no soporta. Se corrige en PR C pasando a `tsx`.
