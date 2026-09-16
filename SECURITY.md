# Política de Seguridad de Portaless

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad de seguridad, por favor NO abras un
Issue público. Escribe directamente a los mantenedores (ver README para
el contacto vigente) con:

- Descripción del problema y su impacto potencial.
- Pasos para reproducirlo.
- Versión afectada (`v0.0.x`).

## Vulnerabilidades conocidas y documentadas en este MVP

Portaless documenta explícitamente, en el código y no solo aquí, los
riesgos de seguridad no resueltos de su propio MVP:

- **`isolated-vm` (adaptador self-hosted de sandboxing)**: las versiones
  ≤7.0.0 son vulnerables a GHSA-864f-rcv7-6rh4 (RCE por type confusion).
  El adaptador (`packages/plugin-sandbox/src/adapters/node-isolated-vm.ts`)
  rechaza instanciarse con versiones vulnerables, pero cualquier despliegue
  self-hosted debe monitorear activamente nuevas CVEs de esta dependencia.
- **Verificación criptográfica de Web Bot Auth**: desde v0.0.9, el Trust
  Layer SI valida matemáticamente la firma Ed25519 (RFC 9421), con cache
  del directorio de claves del operador y verificación de unicidad de
  nonce (rechaza un replay exacto). Antes de v0.0.9, esta capa solo
  resolvía el directorio de claves sin validar la firma -- esa limitación
  ya no aplica, pero sigue siendo una capa de identificación de agentes,
  no un mecanismo de autorización equivalente a autenticación de usuarios.
- **Persistencia**: el Centro de Permisos y el ledger del Trust Layer
  tienen persistencia real (D1/SQLite) conectada end-to-end desde v0.0.9.2
  y v0.0.9.3 respectivamente -- ya no se pierden al reiniciar el proceso
  si se configura un backend real. Sin embargo, `PasswordResetStore`
  (recuperación de contraseña, agregado en v0.0.9.4) SIGUE usando
  únicamente almacenamiento en memoria -- los tokens de recuperación
  pendientes se pierden si el proceso reinicia antes de que el usuario
  complete el flujo. No usar como fuente de verdad de auditoría en
  producción ninguna pieza que todavía dependa de memoria sin verificar
  primero cuál backend está configurado.
- **Puente de capacidades del sandbox de plugins**: desde v0.0.9.4, las
  12/12 capacidades del catálogo (incluyendo `content:read`/
  `content:write`, las últimas 2 en cerrarse) tienen puente real hacia el
  host cuando están concedidas. Esto significa que un plugin con
  `content:write` concedido puede modificar contenido real del sitio --
  revisar con cuidado qué capacidades se otorgan a cada plugin desde el
  Centro de Permisos, especialmente para plugins de terceros no auditados
  (AppPlace, AppLibre, o instalaciones privadas).
- **2FA, recuperación de contraseña y OAuth/SSO (nuevos en v0.0.9.4)**:
  el flujo de 2FA (TOTP) y recuperación de contraseña están cubiertos por
  tests unitarios, pero `functions/admin/login.js` (el endpoint de login
  existente antes de v0.0.9.4) todavía no fue actualizado para redirigir
  al segundo paso cuando `AuthService.login()` devuelve
  `mfaRequired:true` -- verificar esa integración manual antes de
  confiar en 2FA como protección real en producción. Ver
  `docs/architecture/authentication.md`.
- **Licencia del proyecto**: desde v0.0.9.4, el núcleo de Portaless se
  distribuye bajo AGPL-3.0 (antes MIT) -- esto no es una vulnerabilidad de
  seguridad técnica, pero se documenta aquí porque cambia las obligaciones
  legales de cualquiera que modifique el núcleo y lo ofrezca como
  servicio de red. Ver `docs/architecture/licensing-boundaries.md`.

## Alcance

Este proyecto es un MVP en desarrollo activo (v0.0.x). No se recomienda
su uso en producción con datos sensibles reales hasta alcanzar una
versión 0.1.0 con los puntos anteriores resueltos.
