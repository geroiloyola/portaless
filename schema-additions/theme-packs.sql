-- -----------------------------------------------------------------------------
-- v0.0.9.11 -- theme packs: look por pagina (modelo linktree)
-- -----------------------------------------------------------------------------
-- La capa ABIERTA del theming por pagina: un pack instalado (marketplace,
-- futuro slice) aporta SOLO variables CSS de la allowlist -- nunca CSS
-- libre ni una funcion. El pack se guarda como JSON; la validacion pura
-- vive en packages/atomic-elements/src/themes/theme-pack.ts y se aplica al
-- guardar y al cargar. Un pack invalido se ignora al cargar (no tira abajo
-- el catalogo entero). Los packs BUILTIN no se siembran aqui: viven en el
-- codigo (BUILTIN_THEMES) y availableThemes() los fusiona con esta tabla.
-- Ver docs/design/design-guide.md.

CREATE TABLE IF NOT EXISTS theme_packs (
  name TEXT PRIMARY KEY,
  pack_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
