# Autenticación / Roles de Usuario — Estado Real

**Implementado**, en `packages/auth/` + `functions/admin/`. Diseño
intencionalmente simple: usuario/contraseña, dos roles, sin OAuth, sin
2FA, sin recuperación de contraseña por email.

## Qué existe hoy

- `packages/auth/src/password.ts` — hashing con `scrypt`, comparación
  resistente a ataques de temporización.
- `packages/auth/src/auth-service.ts` — único punto de entrada.
- `functions/admin/login.js` — **endpoint POST real**: recibe el
  formulario, llama a `AuthService.login()`, y responde con
  `Set-Cookie: portaless_session=...; HttpOnly; SameSite=Strict;
  Max-Age=86400` (+ `Secure` si la request llego por HTTPS).
- `functions/admin/_middleware.js` — protege `/admin/*`, usando
  persistencia real via `store-factory.ts`.
- **Persistencia real, multi-proveedor** (`packages/auth/src/stores/`):
  `D1UsersStore`/`D1SessionStore` (Cloudflare D1) y
  `SqliteUsersStore`/`SqliteSessionStore` (self-hosted, `node:sqlite`).
  `store-factory.ts` decide el backend segun variables de entorno, con
  fallback a memoria y advertencia explicita.
- `packages/auth/scripts/create-admin.ts` — script de creación del admin
  inicial. Para D1, genera el SQL de inserción para Wrangler.

## Cómo activarlo

**Self-hosted (SQLite):**
```bash
PORTALESS_ADMIN_USERNAME=admin \\
PORTALESS_ADMIN_PASSWORD=una-contrasena-de-al-menos-8-caracteres \\
PORTALESS_SQLITE_PATH=./portaless-auth.sqlite \\
node --experimental-strip-types packages/auth/scripts/create-admin.ts
```

**Cloudflare (D1):**
1. `wrangler d1 create portaless-auth`
2. `wrangler d1 execute portaless-auth --file=packages/auth/src/stores/schema.sql`
3. Agrega el binding `DB` en `wrangler.toml`.
4. Corre `create-admin.ts` sin `PORTALESS_SQLITE_PATH` y ejecuta el SQL
   generado con `wrangler d1 execute`.

## Limitaciones honestas que siguen pendientes

- Sin recuperación de contraseña, sin 2FA, sin OAuth/SSO.
- `node:sqlite` requiere Node 22.5+.
- `canWrite(role)` no esta aplicado en todos los componentes del
  dashboard todavia.
- El script de D1 requiere un paso manual del administrador.
