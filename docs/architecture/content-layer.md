# Capa de Contenido — Estado Real

**Implementado en v0.0.1-v0.0.4**, ubicado en la raíz del repo (no en
`packages/core/` como sugería la propuesta original — ver
`REPO_STRUCTURE_MAP.md` para la razón de esta desviación deliberada).

## Qué existe hoy

- `astro.config.mjs` + `src/pages/` + `src/content/`: motor de contenido
  estático sobre Astro, con colecciones de Markdown (`src/content/posts/`)
  y páginas construidas visualmente (`src/content/pages/*.json` vía
  Atomic Elements, `packages/atomic-elements/`).
- `packages/dashboard/`: panel de administración modular (Skin System).
- `packages/plugin-sandbox/`: contrato de sandboxing multi-proveedor,
  con adaptadores en estado de esqueleto (`TODO` de integración real).
- `packages/permissions/`: Centro de Permisos atómico.

## Qué NO existe todavía

- Sandboxing real ejecutando código de plugin de terceros (los 4
  adaptadores son esqueletos).
- Sistema de roles de usuario más allá de los permisos por
  plugin/agente/tema.
