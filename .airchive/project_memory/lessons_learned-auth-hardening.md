# Lecciones — endurecimiento de auth y self-host (PR E)

- El TOTP no era atacable sin conocer la contraseña: `completeMfaLogin()` exige un challenge que solo emite `login()` con la contraseña correcta. Igual cada challenge admitía intentos ilimitados; ahora el límite es 5 (`MFA_MAX_ATTEMPTS`).
- `pendingMfaChallenges` es un `Map` en memoria del proceso. En Cloudflare cada isolate tiene el suyo, así que un challenge puede no existir en la request siguiente; en self-host un reinicio los borra. Pendiente: persistirlo en D1/SQLite.
- Password-reset: el token es aleatorio y de un solo uso, no hay nada que adivinar. El abuso posible es generar tokens en masa desde `/request`; limitarlo necesita persistencia por IP o usuario. Pendiente junto con el punto anterior.
- `Secure` en cookies solo por HTTPS en todos los caminos de login: contraseña, 2FA y OAuth (`start.js` y `callback.js` juntos, porque la cookie de state también llevaba `Secure`).
- Contraseñas: mínimo de 12 caracteres en `/setup`, `password-reset/confirm` y `change-password`.
- `404.html` ahora se sirve con status 404 en el runtime Node, igual que en Pages.
- `validateSession()` devuelve solo `{ username, role }`. Cualquier código que lea `user.id` o `user.email` desde `context.data.user` recibe `undefined`. El callback de despliegue asociaba todas las credenciales a `"undefined"`; ahora usa `username`. Las credenciales ya guardadas con ese dueño quedan huérfanas.
- El despliegue real en Railway y Render no se puede verificar desde el CI. Checklist en `docs/self-hosting-verification.md`.
