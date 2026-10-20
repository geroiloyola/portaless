# Autenticación / Roles de Usuario — Estado Real

Implementado en `packages/auth/` + `functions/admin/`: usuario/contraseña,
roles, MFA/TOTP, recuperación persistente y OAuth/SSO. La recuperación envía
correo solo con un proveedor configurado; la entrega contra un relay del
operador todavía requiere verificación en la instalación concreta.

## Qué existe hoy

- `packages/auth/src/password.ts` — hashing con `scrypt`, comparación
  resistente a ataques de temporización.
- `packages/auth/src/totp.ts` (v0.0.9.4) — TOTP (RFC 6238) sin
  dependencias externas, compatible con Google Authenticator/Authy/
  1Password.
- `packages/auth/src/password-reset-store.ts` (v0.0.9.4) — tokens de
  recuperación de un solo uso, vida de 30 minutos. **Solo implementación
  en memoria por ahora** -- D1/SQLite reales para este store quedan fuera
  de alcance de v0.0.9.4, ver ROADMAP.md.
- `packages/auth/src/oauth.ts` (v0.0.9.4) — Authorization Code + PKCE
  (RFC 7636) sin librería externa, configurable por variables de entorno
  para cualquier proveedor (no atado a Google/GitHub específicamente).
- `packages/auth/src/auth-service.ts` — único punto de entrada. `login()`
  devuelve `mfaRequired:true` en vez de una sesión si el usuario tiene
  2FA activo; agrega `completeMfaLogin`, `beginTotpEnrollment`,
  `confirmTotpEnrollment`, `disableTotp`, `requestPasswordReset`,
  `completePasswordReset`, `loginWithOAuth`.
- `functions/admin/login.js` — **endpoint POST real**: recibe el
  formulario, llama a `AuthService.login()`, y responde con
  `Set-Cookie: portaless_session=...; HttpOnly; SameSite=Strict;
  Max-Age=86400` (+ `Secure` si la request llego por HTTPS).

   El endpoint también aplica límites persistentes por IP y nombre de usuario;
   una contraseña correcta deriva al challenge MFA, y una respuesta correcta
   limpia esos buckets de fallos.
- `functions/admin/login-mfa.js` (v0.0.9.4, nuevo) — segundo paso de
  login: `POST /admin/login/mfa` con `{ challengeToken, code }`.
- `functions/admin/password-reset/request.js` y `confirm.js` — flujo de
  recuperación persistente y rate-limited. En producción, con email del usuario,
  `PORTALESS_PUBLIC_URL` y un proveedor configurado, envía un enlace de un solo
  uso; si la entrega falla, elimina el token no entregado. El endpoint conserva
  una respuesta uniforme para evitar enumerar cuentas. `PORTALESS_DEV_MODE=1`
  devuelve el token solo fuera de producción.
- `functions/admin/oauth/[provider]/start.js` y `callback.js` (v0.0.9.4,
  nuevos) — flujo completo Authorization Code + PKCE + protección
  anti-CSRF vía `state`.
- `functions/admin/_middleware.js` — protege `/admin/*`, usando
  persistencia real via `store-factory.ts`.
- Las operaciones mutantes protegidas por cookie requieren `Origin` o `Referer`
  del mismo origen y rechazan `Sec-Fetch-Site: cross-site`; se drenan copias de
  los cuerpos para aplicar un máximo común de 8 MiB incluso si el cliente usa
  streaming/chunked. Login, MFA y recuperación, al quedar antes de sesión,
  aplican la misma comprobación de origen en su endpoint.
- **Persistencia real, multi-proveedor** (`packages/auth/src/stores/`):
  `D1UsersStore`/`D1SessionStore` (Cloudflare D1) y
  `SqliteUsersStore`/`SqliteSessionStore` (self-hosted, `better-sqlite3`
  via `openSqlite()` desde v0.0.9.27; `node:sqlite` quedo prohibido).
  `store-factory.ts` decide el backend segun variables de entorno, con
  fallback a memoria y advertencia explicita. `createPasswordResetStore()`
  tambien resuelve D1/SQLite reales desde v0.0.9.6 (ya no es "siempre en
  memoria"). Desde v0.0.9.10 los dos `UsersStore` reales implementan la
  superficie completa de la interfaz -- email, `setPasswordByUsername`,
  TOTP (`setTotpSecret`/`clearTotpSecret`) y OAuth
  (`findByOAuthSubject`/`linkOAuthAccount`/`createOAuthUser`); las
  columnas nuevas de la tabla `users` se agregan solas con `ALTER TABLE`
  en bases creadas antes de esa version. Antes de v0.0.9.10 esos metodos
  existian solo en `InMemoryUsersStore`, asi que 2FA y login-OAuth en
  produccion reventaban con `not a function`.
- `src/pages/admin/login-mfa.astro` y `password-reset.astro` (v0.0.9.4,
  nuevos) — páginas del segundo paso de login y del flujo de
  recuperación de contraseña.

## Cómo activarlo

**Self-hosted (SQLite) -- comando único desde v0.0.9.4:**
```bash
PORTALESS_ADMIN_USERNAME=admin \
PORTALESS_ADMIN_PASSWORD=una-contrasena-de-al-menos-8-caracteres \
PORTALESS_SQLITE_PATH=./portaless.db \
npm run setup
```
Este comando aplica `schema.sql` (raíz) y crea el admin inicial en un solo
paso -- ver `scripts/SETUP.md`. Reemplaza al script anterior
`packages/auth/scripts/create-admin.ts`, que seguía requiriendo aplicar
el schema por separado.

**Cloudflare (D1):**
1. `wrangler d1 create portaless-auth`
2. `wrangler d1 execute portaless-auth --file=schema.sql` (usa el archivo
   maestro de la raíz, que incluye las tablas de auth, permissions,
   trust-layer y páginas -- ver `scripts/SETUP.md`).
3. Agrega el binding `DB` en `wrangler.toml`.
4. El usuario admin inicial se crea automáticamente la primera vez que
   `functions/admin/login.js` detecta que `listUsers()` devuelve vacío --
   no requiere un script manual aparte contra D1.

**Activar 2FA (una vez logueado):**
1. Llamar a `AuthService.beginTotpEnrollment(username)` -- devuelve
   `{ secret, uri }`. El `uri` (`otpauth://...`) se puede convertir a un
   código QR con cualquier librería estándar para escanear con la app de
   autenticación.
2. El usuario ingresa el código de 6 dígitos que la app genera.
3. Llamar a `AuthService.confirmTotpEnrollment(username, secret, code)` --
   si el código es válido, el secreto se persiste y 2FA queda activo.

**Configurar OAuth con un proveedor (ej. Google):**
```bash
PORTALESS_OAUTH_GOOGLE_CLIENT_ID=...
PORTALESS_OAUTH_GOOGLE_CLIENT_SECRET=...
PORTALESS_OAUTH_GOOGLE_AUTH_URL=https://accounts.google.com/o/oauth2/v2/auth
PORTALESS_OAUTH_GOOGLE_TOKEN_URL=https://oauth2.googleapis.com/token
PORTALESS_OAUTH_GOOGLE_USERINFO_URL=https://openidconnect.googleapis.com/v1/userinfo
```
Sin estas 5 variables para un proveedor dado, el inicio de sesión con ese
proveedor no está disponible -- `loadOAuthProviderConfig()` devuelve
`null` explícitamente, nunca falla de forma silenciosa ni insegura.

## Limitaciones honestas que siguen pendientes

- No hay registro público ni invitación de operadores en Portaless; el Beta
  continúa invite-only por la decisión de bus-factor de `SECURITY.md`.
- El envío de reset/step-up no se ha verificado contra un relay real ni un
  destinatario controlado en esta instalación. Los tests usan un webhook local
  simulado y un SMTP falso.
- No existe un modelo seller/tenant en Portaless. El commerce-plugin es un
  catálogo Medusa/Mercur de una sola tienda configurada, sin checkout propio.
- El runtime SQLite usa `better-sqlite3` sobre Node 24.
- `canWrite(role)` no esta aplicado en todos los componentes del
  dashboard todavia (sí lo está en el único endpoint de escritura de
  páginas y en el endpoint de permisos, ver ROADMAP.md).
- OAuth/SSO no fue probado contra un proveedor real en esta sesión de
  trabajo -- la lógica está cubierta por tests con `fetch` mockeado.
