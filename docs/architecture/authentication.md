# Autenticación / Roles de Usuario — Estado Real

**Implementado en esta versión (MVP mínimo)**, en `packages/auth/`.
Diseño intencionalmente simple: usuario/contraseña, dos roles, sin OAuth,
sin 2FA, sin recuperación de contraseña por email. Ver `ROADMAP.md` en la
raíz del repo para dónde encaja esto en la prioridad general del proyecto.

## Qué existe hoy

- `packages/auth/src/password.ts` — hashing con `scrypt` (nativo de
  Node, sin dependencias externas que requieran compilación), comparación
  con `timingSafeEqual` para evitar ataques de temporización.
- `packages/auth/src/users-store.ts` — `InMemoryUsersStore` +
  `ensureInitialAdmin()` para crear el primer usuario administrador.
- `packages/auth/src/session-store.ts` — sesiones con token aleatorio de
  32 bytes, expiración de 24 horas, **en memoria**.
- `packages/auth/src/auth-service.ts` — único punto de entrada
  (`login`, `logout`, `validateSession`, `canWrite`) que el resto del
  sistema debe usar.
- `src/pages/admin/login.astro` — formulario de login.
- `functions/admin/_middleware.js` — protege toda ruta bajo `/admin/*`
  excepto `/admin/login`, redirigiendo a login si no hay sesión válida.

## Roles

- `admin`: acceso total, incluyendo el Centro de Permisos
  (`packages/permissions/`).
- `viewer`: solo lectura del dashboard, sin poder modificar permisos ni
  configuración. **Nota**: la aplicación real de esta restricción de
  solo-lectura en cada organismo del dashboard queda pendiente — hoy
  `canWrite(role)` existe como utilidad, pero no todos los componentes de
  `packages/dashboard/` la consultan todavía.

## Limitaciones honestas de este MVP

- **Persistencia en memoria**: tanto usuarios como sesiones se pierden al
  reiniciar el proceso. Migrar `UsersStore` y `SessionStore` a SQLite es
  el siguiente paso obligatorio antes de producción real.
- **Sin recuperación de contraseña, sin 2FA, sin OAuth/SSO** — fuera de
  alcance explícito de este MVP.
- **Falta el handler POST real de `/admin/login`** que llame a
  `AuthService.login()` y setee la cookie `Set-Cookie: portaless_session=...;
  HttpOnly; Secure; SameSite=Strict`. Hoy solo existen el formulario y el
  middleware que verifica la cookie, no el endpoint que la genera.
- **Falta el script de creación del admin inicial** desde variables de
  entorno (`PORTALESS_ADMIN_USERNAME` / `PORTALESS_ADMIN_PASSWORD`).

Este es intencionalmente el estado de un MVP de autenticación, no un
sistema terminado — consistente con cómo se documentó cada módulo previo
de este proyecto.
