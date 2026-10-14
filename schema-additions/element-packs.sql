-- -----------------------------------------------------------------------------
-- v0.0.9.11 -- catalogo extensible de elementos (element packs)
-- -----------------------------------------------------------------------------
-- La capa ABIERTA del catalogo de Atomic Elements: un plugin puede contribuir
-- sus propios elementos (schema + template, nunca una funcion de render) para
-- que el editor y un agente MCP los vean y usen, sin que el nucleo cambie.
-- El pack se guarda como JSON; la validacion pura vive en
-- packages/atomic-elements/src/elements/element-pack.ts y se aplica al
-- guardar y al cargar. Un pack invalido se ignora al cargar (no tira abajo el
-- catalogo entero). Ver docs/architecture/element-catalog-plugins.md.
--
-- Los elementos contribuidos son DATA-ONLY: render.kind = "html-template" que
-- el host interpola y escapa. El pack NO entrega una funcion de render -- la
-- frontera es el precedente de ProductGrid (host guarda la funcion, plugin
-- provee datos). "requiresEdgeEval" marca contenido que en modo "static" se
-- renderiza como placeholder y solo se resuelve a request time en el borde.

CREATE TABLE IF NOT EXISTS element_packs (
  name TEXT PRIMARY KEY,
  pack_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
