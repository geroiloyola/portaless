
## v0.0.3

### Agregado
- **Dashboard modular** (`packages/dashboard/`): catálogo de organismos
  atómicos (`TrafficChartPanel`, `AgentLedgerPanel`, `ContentListPanel`,
  `CommerceOrdersPanel`, `CommerceRevenuePanel`, `PolicyPanel`) reutilizables
  entre cualquier skin.
- **Skin Engine** (`packages/dashboard/src/skin-engine/`): `loader.ts`
  resuelve herencia de skins (`extends`) fusionando tokens y layout;
  `renderer.ts` monta los organismos en una grilla configurable;
  `tokens.ts` aplica variables de diseño (color, radio, densidad) a todos
  los átomos automáticamente.
- Tres skins de referencia en `packages/dashboard/src/skins/`: `base.json`,
  `blog.json`, `tienda.json`, `trust-crm.json`.
- `packages/dashboard/docs/CREAR_UN_SKIN.md`: guía para crear un skin nuevo
  editando solo JSON, sin tocar código.

### Notas de esta version
- Un skin solo puede reordenar, redimensionar u ocultar organismos ya
  existentes en el registro — no puede introducir componentes nuevos ni
  CSS libre, por diseño (evita que un skin mal hecho rompa la usabilidad
  del panel).
- El renderer usa DOM directo (framework-agnostic) para poder integrarse
  tanto en una isla de Astro como en un panel SPA independiente.
