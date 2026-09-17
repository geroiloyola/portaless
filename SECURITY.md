# Política de seguridad de Portaless

## Reportar una vulnerabilidad

No abras un issue público para reportar una vulnerabilidad. Contacta de forma privada con los mantenedores mediante el canal de contacto configurado para el proyecto e incluye:

- descripción e impacto potencial;
- versión y componente afectados;
- pasos para reproducirla;
- prueba de concepto, si existe;
- propuesta de mitigación, si la tienes.

No publiques detalles de explotación hasta que exista una evaluación y una coordinación de divulgación.

## Estado de seguridad

Portaless es un alpha / MVP en desarrollo activo. No debe considerarse listo para producción ni utilizarse con datos sensibles sin una revisión independiente y una validación del entorno de despliegue.

Las áreas que requieren especial atención son:

- autenticación, MFA/TOTP, sesiones y OAuth/SSO;
- recuperación de contraseñas y persistencia de sus tokens;
- aislamiento y límites del sandbox de plugins;
- permisos, especialmente `content:write`;
- adaptadores de ejecución self-hosted y edge;
- dependencias npm y vulnerabilidades de la cadena de suministro;
- configuración de Cloudflare, SQLite y secretos de despliegue.

## Requisitos operativos mínimos

Antes de un despliegue público:

- almacena secretos en variables de entorno o un gestor de secretos;
- nunca confirmes archivos `.env`, bases de datos, claves privadas o certificados;
- usa `npm ci` y conserva actualizado `package-lock.json`;
- ejecuta el build, las pruebas y la auditoría de dependencias;
- aplica rate limiting a login, MFA y recuperación de contraseña;
- configura cookies `Secure`, `HttpOnly` y `SameSite` cuando corresponda;
- valida `state`, PKCE y las URL de redirección en OAuth;
- usa persistencia compartida para sesiones y recuperación en despliegues distribuidos;
- valida manifiestos y concede capacidades con política deny-by-default;
- limita memoria, CPU, tiempo de ejecución y salida de red de cada plugin;
- revisa cada plugin de terceros como código no confiable.

## Secretos y datos sensibles

El repositorio incluye archivos de ejemplo, no secretos de producción. Antes de publicar o desplegar ejecuta un escáner de secretos sobre el árbol y, cuando corresponda, sobre el historial. Si se encuentra una credencial, revócala y rótala antes de intentar limpiar el historial.

Nunca habilites `PORTALESS_DEV_MODE` en producción: esa opción puede devolver tokens de recuperación en la respuesta HTTP.

## Controles de CI

La integración continua debe bloquear cambios cuando fallen:

- instalación reproducible con `npm ci`;
- build de producción;
- pruebas automatizadas;
- `npm audit --audit-level=high`;
- validación de manifiestos y análisis de secretos.

Un resultado de auditoría no debe ignorarse mediante `|| true` salvo que exista una excepción documentada, acotada y revisada con fecha de expiración.

## Alcance y limitaciones

Esta política describe el proceso y las expectativas de seguridad del proyecto; no constituye una garantía de seguridad ni una certificación. La seguridad final depende también de la configuración, el proveedor de infraestructura, las dependencias, los plugins instalados y los controles operativos del despliegue.

La documentación de arquitectura y el roadmap pueden contener funcionalidades experimentales o pendientes. No asumas que una función está lista para producción solo porque existe su archivo o interfaz.
