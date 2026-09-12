# Agentes de IA vía MCP — Estado Real

**NO IMPLEMENTADO.** `packages/mcp-server/` en este repositorio es un
stub (ver ese paquete) — package.json + estructura de carpetas, sin
lógica de servidor MCP real.

## Diseño previsto (whitepaper)

- Servidor MCP nativo expone tools para que agentes (Claude, GPT, Cursor)
  puedan leer y proponer cambios de contenido.
- Toda escritura de un agente se guarda como borrador, nunca se publica
  directo — requiere aprobación humana explícita.
- Cuota de tokens configurable por sitio, para controlar el costo de uso
  de IA (ver `packages/mcp-server/src/permissions/` en el stub).
- Registro de auditoría de cada acción del agente
  (`packages/mcp-server/src/audit/` en el stub).

## Por qué no se implementó todavía

El roadmap del proyecto (ver conversación de diseño y `CHANGELOG.md`)
priorizó primero Atomic Elements (editor visual) y el sandboxing de
plugins, porque un agente de IA necesita un esquema de salida validable
—que ya existe gracias a Atomic Elements— antes de poder generar
contenido de forma segura.
