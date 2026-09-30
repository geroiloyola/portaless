# Lecciones — rutas públicas de /admin y paridad de la escalera (PR D)

- La escalera (GitHub Pages → Cloudflare Pages → self-host) solo funciona si el runtime Node se comporta igual que Pages. Cada diferencia rompe algo que en Cloudflare anda.
- Paridad de método: cuando una Function no exporta handler para el método pedido, el runtime Node ahora sirve el asset estático si existe (por ejemplo, `GET /admin/login-mfa` con `login-mfa.js` solo-POST). Si no existe, mantiene el 405 con `Allow`. Esta paridad se infirió; no está documentada explícitamente por Cloudflare.
- El middleware de `/admin/*` también intercepta páginas estáticas. Toda ruta previa al login (API y página) tiene que estar en la allowlist.
- Allowlist de coincidencia exacta en `packages/auth/src/public-admin-paths.ts`, más un patrón estricto para `/admin/oauth/{provider}/(start|callback)`. Nunca `startsWith`. Se rechazan escapes, dobles barras y segmentos punto.
- Los módulos auxiliares van en `packages/`, no en `functions/`: el runtime Node convierte en ruta cualquier `.js` de `functions/`.
- `Secure` en la cookie solo por HTTPS, como ya hacía `login.js`. Con `Secure` fijo, el login con 2FA queda sin sesión en self-host por HTTP en una IP de red local. Corregido en `login-mfa.js`.
- Pendiente: el OAuth de login (`oauth/[provider]/start.js` y `callback.js`) sigue fijando `Secure` siempre, también en la cookie de state. Por HTTP en red local falla. Se corrige en los dos archivos juntos o no sirve.
- `/admin/api/wizard/admin-status` sigue protegido: el wizard entero requiere sesión. El caso "no hay admin" del paso 5 es inalcanzable detrás del middleware; el primer admin se crea en `/setup`.
- Pendiente: `staticResponse()` sirve `404.html` con status 200.
- Pendiente: el paso 5 del wizard todavía muestra `npm run setup` para el caso sin admin; es inalcanzable y debería apuntar a `/setup`.
