# ADR propuesta — Aplicación social tipo foro sobre Portaless

Estado: propuesta. Sin implementación.

## Contexto

Se propone una red social tipo foro construida sobre Portaless.

## Contraste con el modelo actual

Portaless hoy es un CMS de un solo inquilino:

- Un dueño por instalación.
- Sin registro público de usuarios.
- Invitación/administración por roles.
- Sin aislamiento multiusuario.
- Contenido como proyección del estado canónico del nodo.

## Lo que exigiría

- Sesiones de visitantes (no solo admin).
- Moderación y reportes.
- Protección contra spam y abuso.
- Retirada de contenido y obligaciones legales.
- Privacidad y manejo de datos personales.
- Subida de archivos por usuarios no confiables.
- Nueva superficie de ataque (autenticación pública, rate limits, almacenamiento).
- Aislamiento entre usuarios y entre comunidades.
- Moderación y apelaciones.

## Recomendación

Construir la aplicación social como un proyecto aparte con su propio repositorio, reutilizando ideas o paquetes de Portaless solo si se justifica, pero sin convertir el core en una plataforma multiusuario. Portaless sigue siendo un CMS soberano de un solo operador.

## Decisión

Pendiente del dueño. No implementar en Portaless core.
