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
- **Verificación criptográfica de Web Bot Auth incompleta**: el Trust
  Layer (`packages/plugin-sandbox` no — ver Trust Layer del proyecto)
  resuelve el directorio de claves de un operador pero NO valida
  matemáticamente la firma (RFC 9421) todavía. No confiar en esta capa
  como control de acceso real hasta completar esa verificación.
- **Persistencia en memoria**: el Centro de Permisos y el ledger del
  Trust Layer usan almacenamiento en memoria en este MVP — se pierden al
  reiniciar el proceso. No usar como fuente de verdad de auditoría en
  producción sin migrar a persistencia real.

## Alcance

Este proyecto es un MVP en desarrollo activo (v0.0.x). No se recomienda
su uso en producción con datos sensibles reales hasta alcanzar una
versión 0.1.0 con los puntos anteriores resueltos.
