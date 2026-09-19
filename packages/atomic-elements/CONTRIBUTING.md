# Contribuir a @portaless/atomic-elements

## Regla de diseño: data verificable vs. presentación

Este paquete separa dos capas que no deben mezclarse nunca:

- **Data** (el modelo de datos y cualquier cosa que un verificador externo
  pueda comprobar objetivamente: catálogo, precios, disponibilidad,
  structured data / JSON-LD).
- **Presentación** (cómo se renderiza esa data: layout, grid/list/masonry,
  filtros visuales, estilos).

### La constraint, explícita

> **Cualquier dato que `SiteTrustScore` (ver `docs/architecture/
> site-trust-score.md` en la raíz del repo) verifique o pueda verificar en
> el futuro — en particular la fuente `agent`, categoría
> `structured_data_quality` — debe generarse en una función del core
> (`packages/atomic-elements/src/`), nunca en un plugin de presentación
> ni en el registro de elementos (`elements/registry.ts`).**

Si un elemento nuevo de Atomic Elements expone datos verificables (por
ejemplo, un futuro `TestimonialGrid` con `AggregateRating`, o un
`FAQSection` con `FAQPage` de Schema.org), la función que genera *ese
dato estructurado* vive junto a `buildJsonLd`/`buildProductJsonLd` en
`src/seo/json-ld.ts` (o un módulo hermano en `src/seo/`), no dentro de
`renderHTML`/`renderHTMLAsync` del elemento en `elements/registry.ts`.

### Por qué

Un plugin de presentación es, por definición, reemplazable — cualquier
administrador puede desinstalarlo e instalar otro. Si la lógica que
genera structured data vive ahí, un verificador externo (un agente de IA
reportando sobre `agent.structured_data_quality`, o simplemente Google)
no puede confiar en que el JSON-LD sea coherente con los datos reales del
sitio: dependeria de la honestidad de cada plugin instalado, no de una
garantía del core.

`buildJsonLd` (`src/seo/json-ld.ts`) es el ejemplo de referencia: resuelve
los productos reales de Medusa vía el mismo camino que ya usa el HTML
(`ProductGrid.renderHTMLAsync` en `elements/registry.ts`), pero la
función que arma el `@graph` de Schema.org vive en el core, fuera del
alcance de cualquier plugin.

### Qué SÍ es responsabilidad de un plugin de presentación

- Layouts avanzados (masonry, carousels, faceted search visual).
- A/B testing de presentación.
- Integraciones con PIMs externos que no afecten el JSON-LD generado por
  el core.
- Personalización visual por segmento de usuario.

### Checklist rápido antes de agregar un elemento nuevo

1. ¿Este elemento va a mostrar algo que un agente externo podría querer
   verificar (precio, disponibilidad, autor, fecha, calificación)?
   - Si sí: la función que genera ese structured data va en `src/seo/`,
     no en `elements/registry.ts`.
2. ¿El elemento consume una fuente de datos externa (como Medusa)?
   - Usa el mismo patrón de import dinámico + manejo de errores que
     `resolveProductGridProducts` en `src/seo/json-ld.ts` — nunca lanza,
     devuelve un valor vacío/neutral si la fuente no está disponible.
3. ¿La función que genera el dato verificable coincide exactamente con
   lo que el HTML ya muestra?
   - Si el HTML aplica un `limit` o un filtro, el generador de JSON-LD
     debe aplicar el mismo — de lo contrario el JSON-LD queda incoherente
     con lo que el usuario ve, que es exactamente el bug que corrigió
     v0.0.9.24/25 en `buildJsonLd`.
