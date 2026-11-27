# ADR-002 — Raíz de confianza del primer arranque self-hosted

- Estado: aceptado (PR B)
- Reemplaza: la política "cero endpoints de creación de admin" documentada en `functions/admin/api/wizard/admin-status.js`

## Contexto

Hasta ahora el primer admin solo se creaba con `npm run setup` o `npm run setup:d1`. Esa regla protegía instalaciones abandonadas en Cloudflare Pages, pero impide los despliegues de un clic (Railway, Render, Docker) donde el usuario no tiene terminal.

## Decisión

Existe un único endpoint de creación de admin, `POST /api/setup/complete`, con estas restricciones:

1. Solo funciona en el runtime Node. El servicio llega como `env.__PORTALESS_FIRST_RUN`, que lo inyecta `scripts/start-docker.mjs`. En Cloudflare Pages los endpoints responden 404.
2. Exige un setup code de 8 caracteres. En disco solo queda su hash SHA-256 con sal, dentro de `portaless-secrets.json`.
3. El código vence a los 60 minutos y permite 5 intentos fallidos. Cada reinicio sin admin genera un código nuevo.
4. Es de un solo uso: al completar el setup se borran el hash y `SETUP_CODE.txt`, y `consumed` queda en `true` de forma irreversible.
5. Queda deshabilitado si existe cualquier usuario.
6. Las respuestas no distinguen entre código incorrecto, vencido o agotado.
7. Las requests se procesan en serie, así que dos requests simultáneas no pueden crear dos admins.
8. Se rechazan las requests con un `Origin` distinto del del servidor.
9. La contraseña del primer admin exige al menos 12 caracteres. Subir `change-password.js` de 8 a 12 queda como deuda técnica para un PR aparte.

Los endpoints viven en `/api/setup/*`, fuera de `/admin/*`, para no tocar `functions/admin/_middleware.js`.

## Consecuencias

- El modelo de amenaza asume que quien lee los logs o el volumen es el operador legítimo.
- Si los 5 intentos se agotan, hace falta reiniciar el servicio para obtener un código nuevo.
- Si se borran todos los usuarios después del setup, este flujo no se reactiva: hay que usar `npm run setup`.
