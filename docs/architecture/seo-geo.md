# SEO/GEO Nativo Basico

## Que se agrego

- packages/atomic-elements/src/seo/json-ld.ts: buildJsonLd y buildProductJsonLd.
- packages/atomic-elements/astro-integration/JsonLd.astro: inyecta el script ld+json.
- src/components/SeoHead.astro: meta tags basicos.
- src/lib/seo.ts: helpers.
- src/pages/sitemap.xml.ts y robots.txt.ts.

## Integracion pendiente

En src/pages/paginas/[slug].astro agregar JsonLd + SeoHead con getSiteUrl/buildCanonicalUrl. Verificar `site` en astro.config.mjs.

## Nota sobre GEO

No es un modulo separado: la misma superficie de datos estructurados beneficia tanto a SEO clasico como a crawlers de IA.
