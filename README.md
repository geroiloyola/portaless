

## Dashboard modular con Skin System (nuevo en v0.0.3)

El panel de administración de Portaless (`packages/dashboard/`) se basa en
**Atomic Design**: un catálogo fijo de organismos (`TrafficChartPanel`,
`AgentLedgerPanel`, `ContentListPanel`, `CommerceOrdersPanel`,
`CommerceRevenuePanel`, `PolicyPanel`) que cualquier "skin" puede reordenar,
redimensionar u ocultar mediante un simple archivo `skin.json` — sin escribir
código nuevo. Incluye tres skins de referencia: `blog`, `tienda` y
`trust-crm`.

Ver `packages/dashboard/docs/CREAR_UN_SKIN.md` para crear tu propio skin, y
`Portaless_Skin_System.md` (raíz del proyecto) para el diseño completo del
sistema y por qué es más simple que un theme de WordPress.
