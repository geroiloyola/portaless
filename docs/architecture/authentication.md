# Autenticación / Roles de Usuario — Estado Real

**Implementado**, en `packages/auth/` + `functions/admin/`. Diseño
inicialmente simple (usuario/contraseña, dos roles) extendido en v0.0.9.4
con verificación en 2 pasos (2FA/TOTP), recuperación de contraseña, e
inicio de sesión con proveedores externos (OAuth/SSO).

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

  **NOTA CRÍTICA DE INTEGRACIÓN PENDIENTE (v0.0.9.4):** este archivo
  todavía NO fue actualizado para manejar el caso `mfaRequired:true` --
  si un usuario con 2FA activo intenta loguearse por este endpoint, el
  comportamiento actual no está confirmado (podría tratarlo como error
  genérico en vez de redirigir al segundo paso). Verificar y ajustar
  antes de considerar 2FA protegido end-to-end en producción.
- `functions/admin/login-mfa.js` (v0.0.9.4, nuevo) — segundo paso de
  login: `POST /admin/login/mfa` con `{ challengeToken, code }`.
- `functions/admin/password-reset/request.js` y `confirm.js` (v0.0.9.4,
  nuevos) — flujo completo de recuperación de contraseña. El envío real
  del email con el enlace de recuperación queda fuera de alcance --
  `PORTALESS_DEV_MODE=1` devuelve el token directamente en la respuesta
  para poder probar el flujo sin infraestructura de correo.
- `functions/admin/oauth/[provider]/start.js` y `callback.js` (v0.0.9.4,
  nuevos) — flujo completo Authorization Code + PKCE + protección
  anti-CSRF vía `state`.
- `functions/admin/_middleware.js` — protege `/admin/*`, usando
  persistencia real via `store-factory.ts`.
- **Persistencia real, multi-proveedor** (`packages/auth/src/stores/`):
  `D1UsersStore`/`D1SessionStore` (Cloudflare D1) y
  `SqliteUsersStore`/`SqliteSessionStore` (self-hosted, `node:sqlite`).
  `store-factory.ts` decide el backend segun variables de entorno, con
  fallback a memoria y advertencia explicita. Desde v0.0.9.4 agrega
  `createPasswordResetStore()` (siempre en memoria, ver nota arriba).
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

- `functions/admin/login.js` no fue actualizado para el flujo de 2FA
  (ver nota crítica arriba) -- **verificar antes de confiar en 2FA en
  producción**.
- `PasswordResetStore` solo tiene implementación en memoria -- los
  tokens de recuperación pendientes se pierden si el proceso reinicia.
- El envío real de emails de recuperación de contraseña no está
  implementado -- solo la generación y validación del token.
- `node:sqlite` requiere Node 22.5+.
- `canWrite(role)` no esta aplicado en todos los componentes del
  dashboard todavia (sí lo está en el único endpoint de escritura de
  páginas y en el endpoint de permisos, ver ROADMAP.md).
- OAuth/SSO no fue probado contra un proveedor real en esta sesión de
  trabajo -- la lógica está cubierta por tests con `fetch` mockeado.
